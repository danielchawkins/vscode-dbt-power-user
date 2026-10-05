import { realpathSync } from "fs";
import * as path from "path";
import {
  CancellationToken,
  Disposable,
  DocumentFilter,
  Event,
  EventEmitter,
  LogOutputChannel,
  RelativePattern,
  Uri,
  WorkspaceFolder,
} from "vscode";
import {
  ExecuteCommandRequest,
  State,
  type LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { DBT_LSP_USE_TARGET_LSP, toLspArgs, type LspLaunch } from "../core/lsp";
import { projectRootDigest, type StaticAnalysisMode } from "../core/project";
import {
  clearDiagnosticsOnDelete,
  ProjectDiagnosticsFilter,
} from "./fusionDiagnostics";
import { FusionExecutable } from "./fusionExecutable";
import { spawnProcess, type ChildProcess } from "./process";
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

/** Client command in Fusion's CTE code lenses; not advertised by initialize, and no command here handles it. */
const FUSION_LSP_PREVIEW_CTE = "dbt.previewCte" as const;

type FusionLspCommand =
  | (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS]
  | typeof FUSION_LSP_PREVIEW_CTE;

/** The project fields a Fusion client reads; a Declared Project satisfies it. */
export interface FusionProjectRef {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
}

export type FusionClientState =
  "starting" | "running" | "restarting" | "stopped" | "failed";

export interface FusionClientOptions {
  project: FusionProjectRef;
  /** Supplies the spawned path; its environment is not used. */
  executable: FusionExecutable;
  /** Reused by `restart()` and unexpected-exit restarts. */
  launch: LspLaunch;
  /** Namespaces workspace/executeCommand so two extensions can serve the same window. */
  commandPrefix: string;
  /** Layered over `launch.environment`; the launch's `DBT_LSP_USE_TARGET_LSP` choice still wins. */
  env?: Record<string, string>;
  /** The Declared Project's log channel; receives client, trace and server output. The client never disposes it. */
  outputChannel: LogOutputChannel;
  /** Receives the error messages of each compile the server reports; empty after a clean compile. */
  onCompileErrors?: (messages: string[]) => void;
}

export interface FusionClient extends Disposable {
  readonly project: FusionProjectRef;
  readonly state: FusionClientState;
  /** Configured `fusionPowerUser.staticAnalysis` for this Declared Project; fixed for the client's lifetime. */
  readonly staticAnalysis: StaticAnalysisMode;
  readonly outputChannel: LogOutputChannel;
  readonly failureReason: string | undefined;
  readonly onDidChangeState: Event<FusionClientState>;
  /** Sends `workspace/executeCommand`; `dbt.listNodes` requests are sent one at a time. */
  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T>;
  restart(): Promise<void>;
  /** Awaitable stop path for tests; sync dispose starts this without awaiting. */
  stop(): Promise<void>;
}

type LspRelativePattern = {
  baseUri: string;
  pattern: string;
};

type FusionDocumentFilter = {
  language: string;
  pattern: LspRelativePattern;
};

const EXTENSION_PREFIX_NAMESPACE = "fusionPowerUser";
const CONNECTION_TIMEOUT_MS = 30_000;
/** @internal */
export const DISPOSAL_GRACE_MS = 5_000;
/** @internal */
export const MAX_UNEXPECTED_EXIT_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;
const STDERR_BUFFER_LIMIT = 16_384;
/** @internal */
export const PARTIAL_LINE_LIMIT = 4_096;

export function commandPrefixForProject(project: FusionProjectRef): string {
  return `${EXTENSION_PREFIX_NAMESPACE}:${projectRootDigest(project.root.fsPath)}:`;
}

/** @internal */
export function languageClientIdForProject(project: FusionProjectRef): string {
  return `fusion-lsp-${projectRootDigest(project.root.fsPath)}`;
}

/** @internal */
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
 * @internal
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
 * Drops server code lenses whose command no extension here registers. Fusion emits `dbt.previewCte` lenses for
 * the official dbt extension's client command; `CteCodeLensProvider` supplies the CTE actions instead.
 * @internal
 */
export function withoutUnregisteredLspLenses<
  T extends { command?: { command: string } },
>(lenses: T[] | null | undefined): T[] | null | undefined {
  return lenses?.filter(
    (lens) => lens.command?.command !== FUSION_LSP_PREVIEW_CTE,
  );
}

/**
 * Per-project LSP document filters using protocol RelativePattern bases.
 * Selectors isolate disjoint Declared Project roots; overlapping roots are not
 * isolated.
 * @internal
 */
export function documentSelectorForProject(root: Uri): FusionDocumentFilter[] {
  const baseUri = root.toString();
  const selector: FusionDocumentFilter[] = FUSION_DOCUMENT_LANGUAGES.map(
    (language) => ({ language, pattern: { baseUri, pattern: PROJECT_GLOB } }),
  );
  validateDocumentSelectorPatterns(selector);
  return selector;
}

/** The VS Code form of {@link documentSelectorForProject}, for editor surfaces scoped to one project. */
export function vscodeDocumentSelectorForProject(root: Uri): DocumentFilter[] {
  return FUSION_DOCUMENT_LANGUAGES.map((language) => ({
    language,
    pattern: new RelativePattern(root, PROJECT_GLOB),
  }));
}

const FUSION_DOCUMENT_LANGUAGES = ["jinja-sql", "sql", "yaml"] as const;
const PROJECT_GLOB = "**/*";

/** @internal */
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

/**
 * Returns minimal dbt config: `{lsp:{linter:{enabled:bool}}}`, null for other sections.
 * @internal
 */
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

/**
 * Line buffer for piped Fusion server stdout/stderr.
 * @internal
 */
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

/**
 * Child process adapter; stderr-only accumulator feeds getStderr().
 * @internal
 */
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
  ) => Promise<ClientHandle>;
  sleep?: (ms: number) => Promise<void>;
};

type ClientHandle = Pick<
  LanguageClient,
  "start" | "stop" | "sendRequest" | "onDidChangeState" | "dispose"
> &
  Partial<Pick<LanguageClient, "diagnostics" | "onNotification">>;

/** Fusion's notifications that end a compile; `errors` lists what it found. */
const FUSION_COMPILE_COMPLETE = [
  "dbt/lspCompileComplete",
  "dbt/lspBackgroundCompileComplete",
] as const;

/**
 * The `Error`-severity messages of a compile-complete notification's `errors`.
 * @internal
 */
export function compileErrorMessages(params: unknown): string[] {
  const errors = (params as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((error: { message?: unknown; severity?: unknown }) =>
    error?.severity === "Error" && typeof error.message === "string"
      ? [error.message]
      : [],
  );
}

export interface FusionClientFactory {
  create(options: FusionClientOptions): FusionClient;
}

export class DefaultFusionClientFactory implements FusionClientFactory {
  constructor(private readonly deps: FusionLanguageClientDependencies = {}) {}

  create(options: FusionClientOptions): FusionClient {
    return new FusionLanguageClientImpl(options, this.deps);
  }
}

class FusionLanguageClientImpl implements FusionClient {
  private _state: FusionClientState = "stopped";
  private _failureReason: string | undefined;
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
  private languageClient: ClientHandle | undefined;
  private deletionWatcher: Disposable | undefined;
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
  private listNodesQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: FusionClientOptions,
    private readonly deps: FusionLanguageClientDependencies,
  ) {
    void this.begin();
  }

  get project(): FusionProjectRef {
    return this.options.project;
  }

  get state(): FusionClientState {
    return this._state;
  }

  get onDidChangeState(): Event<FusionClientState> {
    return this._onDidChangeState.event;
  }

  get staticAnalysis(): StaticAnalysisMode {
    return this.options.launch.staticAnalysis;
  }

  get failureReason(): string | undefined {
    return this._failureReason;
  }

  get outputChannel(): LogOutputChannel {
    return this.options.outputChannel;
  }

  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T> {
    if (command !== FUSION_LSP_COMMANDS.listNodes) {
      return this.send(command, payload, token);
    }
    const sent = this.listNodesQueue.then(() =>
      this.send<T>(command, payload, token),
    );
    this.listNodesQueue = sent.catch(() => undefined);
    return sent;
  }

  private send<T>(
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
      this._onDidChangeState.dispose();
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
    const spawnServer =
      this.deps.spawnProcess ??
      ((executable, args, env, cwd) =>
        spawnProcess(executable, args, {
          env,
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        }));

    const { launch } = this.options;
    const selector = documentSelectorForProject(this.options.project.root);
    const { launchRoot, uriConverters } = canonicalProjectRoot(
      this.options.project.root.fsPath,
    );
    const root = this.options.project.root;
    const diagnosticsFilter = new ProjectDiagnosticsFilter([
      root.fsPath,
      launchRoot,
    ]);

    const server = await listen();
    this.reverseSocket = server;

    try {
      const args = toLspArgs(launch, {
        port: server.port,
        projectDir: launchRoot,
        commandPrefix: this.options.commandPrefix,
      });
      const { [DBT_LSP_USE_TARGET_LSP]: _ignored, ...callerEnv } =
        this.options.env ?? {};
      const env = { ...launch.environment, ...callerEnv };

      const child = spawnServer(
        this.options.executable.path,
        args,
        env,
        launchRoot,
      );
      const processAdapter = new SpawnedLspProcess(child, (line) => {
        this.outputChannel.appendLine(line);
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
          outputChannel: this.outputChannel,
          traceOutputChannel: this.outputChannel,
          workspaceFolder: {
            uri: this.options.project.folder.uri,
            name: this.options.project.folder.name,
            index: this.options.project.folder.index,
          },
          middleware: {
            provideCodeLenses: async (document, token, next) =>
              withoutUnregisteredLspLenses(await next(document, token)),
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
                      launch.lintEnabled,
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
      this.deletionWatcher = clearDiagnosticsOnDelete(
        root,
        () => client.diagnostics,
      );
      const onCompileErrors = this.options.onCompileErrors;
      if (onCompileErrors) {
        for (const method of FUSION_COMPILE_COMPLETE) {
          client.onNotification?.(method, (params: unknown) =>
            onCompileErrors(compileErrorMessages(params)),
          );
        }
      }
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

    this.deletionWatcher?.dispose();
    this.deletionWatcher = undefined;

    await this.shutdownLanguageClient();

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
          this.outputChannel.warn(
            `Fusion LSP process for ${this.options.project.name} did not exit after SIGKILL`,
          );
        }
      }
    }
  }

  private async shutdownLanguageClient(): Promise<void> {
    const client = this.languageClient;
    if (!client) {
      return;
    }
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

  private recordFailure(message: string): void {
    if (!this._failureReason) {
      this._failureReason = message;
    }
    this.outputChannel.warn(message);
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
  readonly state: FusionClientState = "failed";
  readonly staticAnalysis: StaticAnalysisMode;
  readonly failureReason: string;

  /** Writes `message` to `outputChannel`, which it never disposes. */
  constructor(
    readonly project: FusionProjectRef,
    private readonly message: string,
    staticAnalysis: StaticAnalysisMode,
    readonly outputChannel: LogOutputChannel,
  ) {
    this.failureReason = message;
    this.staticAnalysis = staticAnalysis;
    this.outputChannel.warn(message);
  }

  get onDidChangeState(): Event<FusionClientState> {
    return this._onDidChangeState.event;
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
    this._onDidChangeState.dispose();
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
