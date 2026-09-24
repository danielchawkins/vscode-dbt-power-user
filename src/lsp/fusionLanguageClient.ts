import { DBTTerminal } from "@altimateai/dbt-integration";
import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { existsSync, realpathSync } from "fs";
import * as path from "path";
import {
  CancellationToken,
  Disposable,
  Event,
  EventEmitter,
  LogOutputChannel,
  Uri,
  window,
} from "vscode";
import {
  State,
  type LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { ExecuteCommandRequest } from "vscode-languageserver-protocol/node";
import { FusionExecutable } from "../fusion/fusionExecutable";
import {
  resolveConfiguredStaticAnalysisMode,
  resolveStaticAnalysisSelection,
  staticAnalysisLaunchArgument,
  type StaticAnalysisSelection,
} from "../fusion/staticAnalysisMode";
import { DeclaredProject } from "../projects/projectRegistry";
import {
  fusionLogLevelArgument,
  FusionTraceServerLevel,
  resolveFusionLaunchSettings,
} from "./fusionClientSettings";
import {
  acceptWithProcessExit,
  ExitingProcess,
  listenForServer,
  ReverseSocketServer,
} from "./reverseSocketTransport";

export const FUSION_LSP_COMMANDS = {
  listNodes: "dbt.listNodes",
  getCurrentNode: "dbt.getCurrentNode",
  compileFile: "dbt.compileFile",
  compileLsp: "dbt.compileLsp",
  clearTarget: "dbt.clearTarget",
  getProjectInfo: "dbt.getProjectInfo",
  show: "dbt.show",
} as const;

/** Unverified; not advertised by Fusion 2.0.5 initialize. */
export const FUSION_LSP_PREVIEW_CTE = "dbt.previewCte" as const;

export type FusionLspCommand =
  | (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS]
  | typeof FUSION_LSP_PREVIEW_CTE;

export type FusionClientState =
  "starting" | "running" | "restarting" | "stopped" | "failed";

export interface FusionClientOptions {
  project: DeclaredProject;
  executable: FusionExecutable;
  lintEnabled: boolean;
  /** Namespaces workspace/executeCommand so two extensions can serve the same window. */
  commandPrefix: string;
}

export interface FusionClient extends Disposable {
  readonly project: DeclaredProject;
  readonly state: FusionClientState;
  readonly staticAnalysis: StaticAnalysisSelection;
  readonly outputChannel: LogOutputChannel;
  readonly failureReason: string | undefined;
  readonly onDidChangeState: Event<FusionClientState>;
  readonly onDidChangeStaticAnalysis: Event<StaticAnalysisSelection>;
  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T>;
  restart(): Promise<void>;
  /** Awaitable stop path for tests; sync dispose starts this without awaiting. */
  stop(): Promise<void>;
}

export type LspRelativePattern = {
  baseUri: string;
  pattern: string;
};

export type FusionDocumentFilter = {
  language: string;
  pattern: LspRelativePattern;
};

export interface FusionLaunchArgsInput {
  port: number;
  projectRoot: string;
  commandPrefix: string;
  lintEnabled: boolean;
  staticAnalysisMode: ReturnType<typeof resolveConfiguredStaticAnalysisMode>;
  traceServer: FusionTraceServerLevel;
  profilesDir?: string;
  target?: string;
}

const EXTENSION_PREFIX_NAMESPACE = "fusionPowerUser";
export const CONNECTION_TIMEOUT_MS = 30_000;
export const DISPOSAL_GRACE_MS = 5_000;
export const MAX_UNEXPECTED_EXIT_RETRIES = 3;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8_000;
const STDERR_BUFFER_LIMIT = 16_384;
export const PARTIAL_LINE_LIMIT = 4_096;

export function projectRootDigest(rootFsPath: string): string {
  return createHash("sha256")
    .update(rootFsPath)
    .digest("base64url")
    .slice(0, 12);
}

export function commandPrefixForProject(project: DeclaredProject): string {
  return `${EXTENSION_PREFIX_NAMESPACE}:${projectRootDigest(project.root.fsPath)}:`;
}

export function languageClientIdForProject(project: DeclaredProject): string {
  return `fusion-lsp-${projectRootDigest(project.root.fsPath)}`;
}

/** Deterministic per Declared Project; disambiguates duplicate project names. */
export function fusionOutputChannelName(project: DeclaredProject): string {
  const digest = projectRootDigest(project.root.fsPath);
  return `dbt Fusion LSP (${project.name} · ${digest})`;
}

export function prefixedCommand(
  commandPrefix: string,
  command: FusionLspCommand,
): string {
  return `${commandPrefix}${command}`;
}

/**
 * Fusion canonicalizes `--project-dir` but matches document URIs literally, so a project opened through a
 * symlink loads no documents. Returns the realpath to launch Fusion on and converters that move URIs between
 * the opened root and that realpath; converters are undefined when the two are the same.
 */
export function canonicalProjectRoot(
  root: string,
  realpath: (fsPath: string) => string = realpathSync.native,
): {
  launchRoot: string;
  uriConverters?: LanguageClientOptions["uriConverters"];
} {
  let launchRoot: string;
  try {
    launchRoot = realpath(root);
  } catch {
    return { launchRoot: root };
  }
  if (launchRoot === root) {
    return { launchRoot };
  }
  const remap = (
    fsPath: string,
    from: string,
    to: string,
  ): string | undefined => {
    if (fsPath === from) {
      return to;
    }
    return fsPath.startsWith(from + path.sep)
      ? to + fsPath.slice(from.length)
      : undefined;
  };
  return {
    launchRoot,
    uriConverters: {
      code2Protocol: (uri) => {
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, root, launchRoot)
            : undefined;
        return (mapped ? Uri.file(mapped) : uri).toString();
      },
      protocol2Code: (value) => {
        const uri = Uri.parse(value);
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, launchRoot, root)
            : undefined;
        return mapped ? Uri.file(mapped) : uri;
      },
    },
  };
}

/**
 * Decides which `publishDiagnostics` notifications reach the editor. Fusion publishes diagnostics for its bundled
 * package macros under the project root although those files do not exist there; Cursor's renderer stalls on
 * them. A URI whose file is missing is dropped unless an earlier notification for it was forwarded, so the clear
 * for a file deleted after it had diagnostics still arrives.
 */
export class ExistingFileDiagnostics {
  private readonly forwarded = new Set<string>();

  constructor(
    private readonly exists: (fsPath: string) => boolean = existsSync,
  ) {}

  shouldForward(uri: Uri): boolean {
    const key = uri.toString();
    if (
      uri.scheme !== "file" ||
      this.forwarded.has(key) ||
      this.exists(uri.fsPath)
    ) {
      this.forwarded.add(key);
      return true;
    }
    return false;
  }
}

export function buildFusionLspArgs(input: FusionLaunchArgsInput): string[] {
  const args = [
    "lsp",
    "--socket",
    String(input.port),
    "--project-dir",
    input.projectRoot,
    "--lint-enabled",
    input.lintEnabled ? "true" : "false",
    "--static-analysis",
    staticAnalysisLaunchArgument({
      configured: input.staticAnalysisMode,
      effective: "unknown",
    }),
    "--no-version-check",
    "--command-prefix",
    input.commandPrefix,
  ];

  if (input.profilesDir) {
    args.push("--profiles-dir", input.profilesDir);
  }
  if (input.target) {
    args.push("--target", input.target);
  }

  const logLevel = fusionLogLevelArgument(input.traceServer);
  if (logLevel) {
    args.push("--log-level", logLevel);
  }

  return args;
}

/**
 * Per-project LSP document filters using protocol RelativePattern bases.
 * Selectors isolate disjoint Declared Project roots; overlapping roots remain
 * an S3 limitation and are not discharged here.
 */
export function documentSelectorForProject(root: Uri): FusionDocumentFilter[] {
  const baseUri = root.toString();
  const glob = "**/*";
  const selector: FusionDocumentFilter[] = [
    { language: "jinja-sql", pattern: { baseUri, pattern: glob } },
    { language: "sql", pattern: { baseUri, pattern: glob } },
    { language: "yaml", pattern: { baseUri, pattern: glob } },
  ];
  validateDocumentSelectorPatterns(selector);
  return selector;
}

export function validateDocumentSelectorPatterns(
  selector: readonly FusionDocumentFilter[],
): void {
  for (const filter of selector) {
    if (
      typeof filter !== "object" ||
      filter === null ||
      !("pattern" in filter) ||
      filter.pattern === undefined
    ) {
      throw new Error("Fusion LSP document selector filter missing pattern");
    }
    const pattern = filter.pattern;
    if (typeof pattern !== "object" || pattern === null) {
      throw new Error("Fusion LSP document selector pattern must be an object");
    }
    const baseUri = (pattern as { baseUri?: unknown }).baseUri;
    const glob = (pattern as { pattern?: unknown }).pattern;
    if (typeof baseUri !== "string" || baseUri.trim() === "") {
      throw new Error(
        "Fusion LSP document selector baseUri must be a string URI",
      );
    }
    if (typeof glob !== "string" || glob.trim() === "") {
      throw new Error("Fusion LSP document selector pattern must be non-empty");
    }
  }
}

/** Returns minimal dbt config: `{lsp:{linter:{enabled:bool}}}`, null for other sections. */
export function buildWorkspaceConfigurationResponse(
  section: string,
  lintEnabled: boolean,
): unknown {
  if (section === "dbt") {
    return {
      lsp: {
        linter: {
          enabled: lintEnabled,
        },
      },
    };
  }
  return null;
}

/** Line buffer for piped Fusion server stdout/stderr. */
export class ProcessStreamBuffer {
  private partial = "";

  feed(chunk: Buffer | string, onLine: (line: string) => void): void {
    this.partial += chunk.toString();
    const parts = this.partial.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        onLine(trimmed);
      }
    }
    if (this.partial.length > PARTIAL_LINE_LIMIT) {
      this.partial = this.partial.slice(0, PARTIAL_LINE_LIMIT);
    }
  }

  flush(onLine: (line: string) => void): void {
    const trimmed = this.partial.trim();
    if (trimmed) {
      onLine(trimmed);
    }
    this.partial = "";
  }
}

class StderrAccumulator {
  private text = "";

  append(line: string): void {
    this.text += `${line}\n`;
    if (this.text.length > STDERR_BUFFER_LIMIT) {
      this.text = this.text.slice(-STDERR_BUFFER_LIMIT);
    }
  }

  get(): string {
    return this.text;
  }
}

/** Child process adapter; stderr-only accumulator feeds getStderr(). */
export class SpawnedLspProcess implements ExitingProcess {
  private readonly stderrAccumulator = new StderrAccumulator();
  private readonly stdoutBuffer = new ProcessStreamBuffer();
  private readonly stderrStreamBuffer = new ProcessStreamBuffer();

  constructor(
    private readonly child: ChildProcess,
    private readonly onChannelLine?: (line: string) => void,
  ) {
    const appendChannelLine = (line: string): void => {
      this.onChannelLine?.(line);
    };
    const appendStderrLine = (line: string): void => {
      this.stderrAccumulator.append(line);
      appendChannelLine(line);
    };
    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.stdoutBuffer.feed(chunk, appendChannelLine);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderrStreamBuffer.feed(chunk, appendStderrLine);
    });
    child.on("close", () => {
      this.stdoutBuffer.flush(appendChannelLine);
      this.stderrStreamBuffer.flush(appendStderrLine);
    });
  }

  get exitCode(): number | null {
    return this.child.exitCode;
  }

  get signalCode(): NodeJS.Signals | null {
    return this.child.signalCode;
  }

  on(event: "exit", listener: () => void): void {
    this.child.on(event, listener);
  }

  removeListener(event: "exit", listener: () => void): void {
    this.child.removeListener(event, listener);
  }

  getStderr(): string {
    return this.stderrAccumulator.get();
  }

  kill(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }
}

export const DBT_LSP_USE_TARGET_LSP = "DBT_LSP_USE_TARGET_LSP" as const;

export type FusionLanguageClientDependencies = {
  listenForServer?: typeof listenForServer;
  acceptWithProcessExit?: typeof acceptWithProcessExit;
  spawnProcess?: (
    executable: string,
    args: string[],
    env: Record<string, string>,
    cwd?: string,
  ) => ChildProcess;
  createLanguageClient?: (
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
  ) => Promise<
    Pick<
      LanguageClient,
      "start" | "stop" | "sendRequest" | "onDidChangeState" | "dispose"
    >
  >;
  createOutputChannel?: (name: string) => LogOutputChannel;
  sleep?: (ms: number) => Promise<void>;
};

export interface FusionClientFactory {
  create(options: FusionClientOptions): FusionClient;
}

export class DefaultFusionClientFactory implements FusionClientFactory {
  constructor(
    private readonly terminal: DBTTerminal,
    private readonly deps: FusionLanguageClientDependencies = {},
  ) {}

  create(options: FusionClientOptions): FusionClient {
    return new FusionLanguageClientImpl(options, this.terminal, this.deps);
  }
}

class FusionLanguageClientImpl implements FusionClient {
  private _state: FusionClientState = "stopped";
  private _staticAnalysis: StaticAnalysisSelection;
  private _failureReason: string | undefined;
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
  private readonly _onDidChangeStaticAnalysis =
    new EventEmitter<StaticAnalysisSelection>();
  private readonly _logChannel: LogOutputChannel;
  private languageClient:
    | Pick<
        LanguageClient,
        "start" | "stop" | "sendRequest" | "onDidChangeState" | "dispose"
      >
    | undefined;
  private reverseSocket: ReverseSocketServer | undefined;
  private childProcess: SpawnedLspProcess | undefined;
  private exitAttempts = 0;
  private restartChain: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | undefined;
  private disposed = false;
  private stateListener: Disposable | undefined;
  private processExitListener: (() => void) | undefined;
  private transportGeneration = 0;
  private unexpectedStopHandledGeneration = 0;

  constructor(
    private readonly options: FusionClientOptions,
    private readonly terminal: DBTTerminal,
    private readonly deps: FusionLanguageClientDependencies,
  ) {
    const createOutputChannel =
      this.deps.createOutputChannel ??
      ((name: string) => window.createOutputChannel(name, { log: true }));
    this._logChannel = createOutputChannel(
      fusionOutputChannelName(this.options.project),
    );
    this._staticAnalysis = resolveStaticAnalysisSelection(
      this.options.project.root,
    );
    void this.begin();
  }

  get project(): DeclaredProject {
    return this.options.project;
  }

  get state(): FusionClientState {
    return this._state;
  }

  get onDidChangeState(): Event<FusionClientState> {
    return this._onDidChangeState.event;
  }

  get staticAnalysis(): StaticAnalysisSelection {
    return this._staticAnalysis;
  }

  get onDidChangeStaticAnalysis(): Event<StaticAnalysisSelection> {
    return this._onDidChangeStaticAnalysis.event;
  }

  get failureReason(): string | undefined {
    return this._failureReason;
  }

  get outputChannel(): LogOutputChannel {
    if (this.disposed) {
      throw new Error("Fusion LSP output channel is disposed");
    }
    return this._logChannel;
  }

  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T> {
    if (!this.languageClient) {
      return Promise.reject(
        new Error(`Fusion LSP client is not running (${this._state})`),
      );
    }
    const args =
      payload === undefined ? [] : Array.isArray(payload) ? payload : [payload];
    return this.languageClient.sendRequest(
      ExecuteCommandRequest.type,
      {
        command: prefixedCommand(this.options.commandPrefix, command),
        arguments: args,
      },
      token,
    ) as Promise<T>;
  }

  restart(): Promise<void> {
    this.exitAttempts = 0;
    return this.scheduleRestart("manual");
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    void this.stop().finally(() => {
      this._logChannel.dispose();
      this._onDidChangeState.dispose();
      this._onDidChangeStaticAnalysis.dispose();
    });
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.doStop();
    }
    return this.stopPromise;
  }

  private async begin(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.scheduleRestart("initial");
  }

  private scheduleRestart(
    reason: "initial" | "manual" | "unexpected",
  ): Promise<void> {
    this.restartChain = this.restartChain.then(() => this.runRestart(reason));
    return this.restartChain;
  }

  private async runRestart(
    reason: "initial" | "manual" | "unexpected",
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.setState(reason === "initial" ? "starting" : "restarting");
    await this.teardownTransport();

    if (this.disposed) {
      return;
    }

    if (reason === "unexpected") {
      const delay = Math.min(
        BACKOFF_BASE_MS * 2 ** (this.exitAttempts - 1),
        BACKOFF_CAP_MS,
      );
      await this.sleep(delay);
      if (this.disposed) {
        return;
      }
    }

    try {
      await this.startTransport();
      this._failureReason = undefined;
      this.setState("running");
    } catch (error) {
      const message = formatError(error);
      if (reason === "unexpected") {
        this.recordFailure(
          `Restart failed for ${this.options.project.name}: ${message}`,
        );
      } else {
        this.recordFailure(
          `Failed to start Fusion LSP for ${this.options.project.name}: ${message}`,
        );
      }
      await this.teardownTransport();
      this.setState("failed");
    }
  }

  private async startTransport(): Promise<void> {
    const listen = this.deps.listenForServer ?? listenForServer;
    const accept = this.deps.acceptWithProcessExit ?? acceptWithProcessExit;
    const spawnProcess =
      this.deps.spawnProcess ??
      ((executable, args, env, cwd) =>
        spawn(executable, args, {
          env,
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        }));

    const launch = resolveFusionLaunchSettings(this.options.project.root);
    const staticAnalysisMode = resolveConfiguredStaticAnalysisMode(
      this.options.project.root,
    );
    this.setStaticAnalysis(
      resolveStaticAnalysisSelection(this.options.project.root),
    );
    const selector = documentSelectorForProject(this.options.project.root);
    const { launchRoot, uriConverters } = canonicalProjectRoot(
      this.options.project.root.fsPath,
    );
    const diagnosticsFilter = new ExistingFileDiagnostics();

    const server = await listen();
    this.reverseSocket = server;

    try {
      const args = buildFusionLspArgs({
        port: server.port,
        projectRoot: launchRoot,
        commandPrefix: this.options.commandPrefix,
        lintEnabled: this.options.lintEnabled,
        staticAnalysisMode,
        traceServer: launch.traceServer,
        profilesDir: launch.profilesDir,
        target: launch.target,
      });

      const env = {
        ...this.options.executable.env,
        [DBT_LSP_USE_TARGET_LSP]: "1",
      };

      const child = spawnProcess(
        this.options.executable.path,
        args,
        env,
        launchRoot,
      );
      const processAdapter = new SpawnedLspProcess(child, (line) => {
        this._logChannel.appendLine(line);
      });
      this.childProcess = processAdapter;

      const createLanguageClient =
        this.deps.createLanguageClient ??
        (async (
          id: string,
          name: string,
          serverOptions: ServerOptions,
          clientOptions: LanguageClientOptions,
        ) => {
          const { LanguageClient } = await import("vscode-languageclient/node");
          return new LanguageClient(id, name, serverOptions, clientOptions);
        });

      const serverOptions: ServerOptions = async () => {
        return accept(server, processAdapter, CONNECTION_TIMEOUT_MS);
      };

      // vscode-languageclient ProgressFeature owns window workDone progress UI.
      const client = await createLanguageClient(
        languageClientIdForProject(this.options.project),
        `dbt Fusion (${this.options.project.name})`,
        serverOptions,
        {
          documentSelector: selector,
          uriConverters,
          connectionOptions: { maxRestartCount: 0 },
          outputChannel: this._logChannel,
          workspaceFolder: {
            uri: this.options.project.folder.uri,
            name: this.options.project.folder.name,
            index: this.options.project.folder.index,
          },
          middleware: {
            handleDiagnostics: (uri, diagnostics, next) => {
              if (diagnosticsFilter.shouldForward(uri)) {
                next(uri, diagnostics);
              }
            },
            workspace: {
              configuration: async (params) => {
                const results: unknown[] = [];
                for (const item of params.items) {
                  results.push(
                    buildWorkspaceConfigurationResponse(
                      item.section ?? "",
                      this.options.lintEnabled,
                    ),
                  );
                }
                return results;
              },
            },
          },
        },
      );

      this.languageClient = client;
      await client.start();

      this.transportGeneration += 1;
      const generation = this.transportGeneration;
      this.stateListener?.dispose();
      this.processExitListener = () => {
        this.scheduleUnexpectedStop(generation);
      };
      this.stateListener = client.onDidChangeState((event) => {
        if (event.newState === State.Stopped && !this.disposed) {
          this.scheduleUnexpectedStop(generation);
        }
      });
      processAdapter.on("exit", this.processExitListener);
    } catch (error) {
      await this.teardownTransport();
      throw error;
    }
  }

  private scheduleUnexpectedStop(signalGeneration: number): void {
    if (
      this.disposed ||
      this.stopPromise ||
      this._state !== "running" ||
      signalGeneration !== this.transportGeneration ||
      this.unexpectedStopHandledGeneration === signalGeneration
    ) {
      return;
    }
    this.unexpectedStopHandledGeneration = signalGeneration;
    void this.handleUnexpectedStop();
  }

  private async handleUnexpectedStop(): Promise<void> {
    if (this.disposed || this.stopPromise || this._state !== "running") {
      return;
    }
    this.exitAttempts += 1;
    if (this.exitAttempts > MAX_UNEXPECTED_EXIT_RETRIES) {
      this.recordFailure(
        `Fusion LSP for ${this.options.project.name} stopped after ${MAX_UNEXPECTED_EXIT_RETRIES} unexpected exit retries`,
      );
      this.setState("failed");
      await this.teardownTransport();
      return;
    }
    await this.scheduleRestart("unexpected");
  }

  private async teardownTransport(): Promise<void> {
    this.stateListener?.dispose();
    this.stateListener = undefined;

    const processAdapter = this.childProcess;
    if (processAdapter && this.processExitListener) {
      processAdapter.removeListener("exit", this.processExitListener);
    }
    this.processExitListener = undefined;

    if (this.languageClient) {
      const client = this.languageClient;
      this.languageClient = undefined;
      try {
        await client.stop();
      } catch {
        // Best-effort shutdown before transport teardown.
      }
      try {
        client.dispose();
      } catch {
        // Best-effort disposal after stop.
      }
    }

    this.reverseSocket?.dispose();
    this.reverseSocket = undefined;

    this.childProcess = undefined;
    if (!processAdapter) {
      return;
    }

    if (
      processAdapter.exitCode === null &&
      processAdapter.signalCode === null
    ) {
      const exitPromise = this.waitForProcessExit(processAdapter);
      processAdapter.kill("SIGTERM");
      const exited = await Promise.race([
        exitPromise.then(() => true),
        this.sleep(DISPOSAL_GRACE_MS).then(() => false),
      ]);
      if (
        !exited &&
        processAdapter.exitCode === null &&
        processAdapter.signalCode === null
      ) {
        const killExitPromise = this.waitForProcessExit(
          processAdapter,
          DISPOSAL_GRACE_MS,
        );
        processAdapter.kill("SIGKILL");
        const killed = await killExitPromise;
        if (!killed) {
          const message = `Fusion LSP process for ${this.options.project.name} did not exit after SIGKILL`;
          this._logChannel.appendLine(message);
          this.terminal.warn("fusionLsp", message);
        }
      }
    }
  }

  private waitForProcessExit(
    processAdapter: SpawnedLspProcess,
    timeoutMs?: number,
  ): Promise<boolean> {
    if (
      processAdapter.exitCode !== null ||
      processAdapter.signalCode !== null
    ) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onExit = (): void => {
        if (timeoutMs !== undefined) {
          clearTimeout(timer);
        }
        processAdapter.removeListener("exit", onExit);
        resolve(true);
      };
      processAdapter.on("exit", onExit);
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              processAdapter.removeListener("exit", onExit);
              resolve(false);
            }, timeoutMs);
    });
  }

  private async doStop(): Promise<void> {
    await this.restartChain;
    this.setState("stopped");
    await this.teardownTransport();
  }

  private setStaticAnalysis(next: StaticAnalysisSelection): void {
    if (
      this._staticAnalysis.configured === next.configured &&
      this._staticAnalysis.effective === next.effective
    ) {
      return;
    }
    this._staticAnalysis = next;
    this._onDidChangeStaticAnalysis.fire(next);
  }

  private recordFailure(message: string): void {
    if (!this._failureReason) {
      this._failureReason = message;
    }
    this._logChannel.appendLine(message);
    this.terminal.warn("fusionLsp", message);
  }

  private setState(next: FusionClientState): void {
    if (this._state === next) {
      return;
    }
    this._state = next;
    this._onDidChangeState.fire(next);
  }

  private sleep(ms: number): Promise<void> {
    const sleepFn =
      this.deps.sleep ?? ((delay) => new Promise((r) => setTimeout(r, delay)));
    return sleepFn(ms);
  }
}

export class FailedFusionClient implements FusionClient {
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
  private readonly _onDidChangeStaticAnalysis =
    new EventEmitter<StaticAnalysisSelection>();
  readonly state: FusionClientState = "failed";
  readonly staticAnalysis: StaticAnalysisSelection;
  readonly outputChannel: LogOutputChannel;
  readonly failureReason: string;

  constructor(
    readonly project: DeclaredProject,
    private readonly message: string,
    private readonly terminal: DBTTerminal,
    createOutputChannel: (name: string) => LogOutputChannel = (name) =>
      window.createOutputChannel(name, { log: true }),
  ) {
    this.failureReason = message;
    this.staticAnalysis = resolveStaticAnalysisSelection(project.root);
    this.outputChannel = createOutputChannel(fusionOutputChannelName(project));
    this.outputChannel.appendLine(message);
    this.terminal.warn("fusionLsp", message);
  }

  get onDidChangeState(): Event<FusionClientState> {
    return this._onDidChangeState.event;
  }

  get onDidChangeStaticAnalysis(): Event<StaticAnalysisSelection> {
    return this._onDidChangeStaticAnalysis.event;
  }

  request<T>(): Promise<T> {
    return Promise.reject(new Error(this.message));
  }

  restart(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.outputChannel.dispose();
    this._onDidChangeState.dispose();
    this._onDidChangeStaticAnalysis.dispose();
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
