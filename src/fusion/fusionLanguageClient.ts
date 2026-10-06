import {
  CancellationToken,
  Disposable,
  Event,
  EventEmitter,
  LogOutputChannel,
} from "vscode";
import {
  ExecuteCommandRequest,
  State,
  type ServerOptions,
} from "vscode-languageclient/node";
import { DBT_LSP_USE_TARGET_LSP, toLspArgs } from "../core/lsp";
import { type StaticAnalysisMode } from "../core/project";
import { documentSelectorForProject } from "./documentSelector";
import {
  DISPOSAL_GRACE_MS,
  FUSION_LSP_COMMANDS,
  languageClientIdForProject,
  MAX_UNEXPECTED_EXIT_RETRIES,
  prefixedCommand,
  type FusionClient,
  type FusionClientOptions,
  type FusionClientState,
  type FusionLspCommand,
  type FusionProjectRef,
} from "./fusionClient";
import {
  clearDiagnosticsOnDelete,
  ProjectDiagnosticsFilter,
} from "./fusionDiagnostics";
import {
  canonicalProjectRoot,
  CompileSignal,
  defaultCreateLanguageClient,
  defaultSpawn,
  languageClientOptions,
  subscribeToCompileComplete,
  type ClientHandle,
  type FusionLanguageClientDependencies,
} from "./lspClientSupport";
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  CONNECTION_TIMEOUT_MS,
  SpawnedLspProcess,
  terminateProcess,
} from "./lspProcess";
import {
  acceptWithProcessExit,
  listenForServer,
  ReverseSocketServer,
} from "./reverseSocketTransport";

export { commandPrefixForProject, FUSION_LSP_COMMANDS } from "./fusionClient";
export type {
  FusionClient,
  FusionClientOptions,
  FusionClientState,
  FusionProjectRef,
} from "./fusionClient";

export type { FusionLanguageClientDependencies } from "./lspClientSupport";

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

  private readonly compiled = new CompileSignal();

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
    const spawnServer = this.deps.spawnProcess ?? defaultSpawn;

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
        this.deps.createLanguageClient ?? defaultCreateLanguageClient;

      const serverOptions: ServerOptions = async () => {
        return accept(server, processAdapter, CONNECTION_TIMEOUT_MS);
      };

      // vscode-languageclient ProgressFeature owns window workDone progress UI.
      const client = await createLanguageClient(
        languageClientIdForProject(this.options.project),
        `dbt Fusion (${this.options.project.name})`,
        serverOptions,
        languageClientOptions({
          project: this.options.project,
          selector,
          uriConverters,
          outputChannel: this.outputChannel,
          diagnosticsFilter,
          lintEnabled: launch.lintEnabled,
          compiled: this.compiled,
        }),
      );

      this.languageClient = client;
      this.deletionWatcher = clearDiagnosticsOnDelete(
        root,
        () => client.diagnostics,
      );
      const { onCompileErrors } = this.options;
      subscribeToCompileComplete(client, this.compiled, onCompileErrors);
      await client.start();

      const generation = (this.transportGeneration += 1);
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

    await terminateProcess(processAdapter, {
      graceMs: DISPOSAL_GRACE_MS,
      sleep: (ms) => this.sleep(ms),
      warn: (message) => this.outputChannel.warn(message),
      name: this.options.project.name,
    });
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
      void client.dispose();
    } catch {
      // Best-effort disposal after stop.
    }
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
