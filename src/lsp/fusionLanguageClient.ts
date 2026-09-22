import { DBTTerminal } from "@altimateai/dbt-integration";
import { spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import {
  CancellationToken,
  Disposable,
  Event,
  EventEmitter,
  Uri,
} from "vscode";
import {
  State,
  type LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { FusionExecutable } from "../fusion/fusionExecutable";
import {
  resolveConfiguredStaticAnalysisMode,
  staticAnalysisLaunchArgument,
} from "../fusion/staticAnalysisMode";
import { DeclaredProject } from "../projects/projectRegistry";
import { resolveFusionLaunchSettings } from "./fusionClientSettings";
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
  readonly onDidChangeState: Event<FusionClientState>;
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

export function prefixedCommand(
  commandPrefix: string,
  command: FusionLspCommand,
): string {
  return `${commandPrefix}${command}`;
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
    { language: "jinja-yaml", pattern: { baseUri, pattern: glob } },
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

class SpawnedLspProcess implements ExitingProcess {
  private stderr = "";

  constructor(private readonly child: ChildProcess) {
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > STDERR_BUFFER_LIMIT) {
        this.stderr = this.stderr.slice(-STDERR_BUFFER_LIMIT);
      }
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
    return this.stderr;
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
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
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
      "workspace/executeCommand",
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
    void this.stop();
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
      this.setState("running");
    } catch (error) {
      await this.teardownTransport();
      if (reason === "unexpected") {
        this.terminal.warn(
          "fusionLsp",
          `Restart failed for ${this.options.project.name}: ${formatError(error)}`,
        );
      } else {
        this.terminal.warn(
          "fusionLsp",
          `Failed to start Fusion LSP for ${this.options.project.name}: ${formatError(error)}`,
        );
      }
      this.setState("failed");
    }
  }

  private async startTransport(): Promise<void> {
    const listen = this.deps.listenForServer ?? listenForServer;
    const accept = this.deps.acceptWithProcessExit ?? acceptWithProcessExit;
    const spawnProcess =
      this.deps.spawnProcess ??
      ((executable, args, env) =>
        spawn(executable, args, {
          env,
          shell: false,
          stdio: ["ignore", "ignore", "pipe"],
        }));

    const launch = resolveFusionLaunchSettings(this.options.project.root);
    const staticAnalysisMode = resolveConfiguredStaticAnalysisMode(
      this.options.project.root,
    );
    const selector = documentSelectorForProject(this.options.project.root);

    const server = await listen();
    this.reverseSocket = server;

    try {
      const args = buildFusionLspArgs({
        port: server.port,
        projectRoot: this.options.project.root.fsPath,
        commandPrefix: this.options.commandPrefix,
        lintEnabled: this.options.lintEnabled,
        staticAnalysisMode,
        profilesDir: launch.profilesDir,
        target: launch.target,
      });

      const child = spawnProcess(
        this.options.executable.path,
        args,
        this.options.executable.env,
      );
      const processAdapter = new SpawnedLspProcess(child);
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

      const client = await createLanguageClient(
        languageClientIdForProject(this.options.project),
        `dbt Fusion (${this.options.project.name})`,
        serverOptions,
        {
          documentSelector: selector,
          connectionOptions: { maxRestartCount: 0 },
          outputChannelName: `dbt Fusion LSP (${this.options.project.name})`,
          workspaceFolder: {
            uri: this.options.project.folder.uri,
            name: this.options.project.folder.name,
            index: this.options.project.folder.index,
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
      this.terminal.warn(
        "fusionLsp",
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
          this.terminal.warn(
            "fusionLsp",
            `Fusion LSP process for ${this.options.project.name} did not exit after SIGKILL`,
          );
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

  constructor(
    readonly project: DeclaredProject,
    private readonly message: string,
    private readonly terminal: DBTTerminal,
  ) {
    this.terminal.warn("fusionLsp", message);
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

export function formatExecutableFailure(
  project: DeclaredProject,
  verdict: { kind: string; path?: string; raw?: string },
): string {
  if (verdict.kind === "notFound") {
    return `Fusion executable not found for ${project.name} at ${verdict.path ?? "unknown path"}`;
  }
  if (verdict.kind === "tooOld") {
    return `Fusion version too old for ${project.name}`;
  }
  if (verdict.kind === "untestedMajor") {
    return `Untested Fusion major version for ${project.name}`;
  }
  return `Fusion executable invalid for ${project.name}`;
}
