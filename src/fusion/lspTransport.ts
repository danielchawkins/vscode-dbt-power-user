import type { Disposable, LogOutputChannel, Uri } from "vscode";
import {
  State,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/node";
import { lspProcessEnv, toLspArgs } from "../core/lsp";
import { errorText } from "../core/text";
import { BOUNDS } from "../core/timing";
import { canonicalProjectRoot } from "./canonicalProjectRoot";
import type { ServerCompileState } from "./compileSignal";
import { subscribeToCompileState } from "./compileSignal";
import { documentSelectorForProject } from "./documentSelector";
import {
  languageClientIdForProject,
  type FusionClientOptions,
} from "./fusionClient";
import {
  clearDiagnosticsOnDelete,
  ProjectDiagnosticsFilter,
} from "./fusionDiagnostics";
import {
  defaultCreateLanguageClient,
  defaultSpawn,
  languageClientOptions,
  type ClientHandle,
  type FusionLanguageClientDependencies,
} from "./lspClientSupport";
import { SpawnedLspProcess, terminateProcess } from "./lspProcess";
import type { ClientNestedRoots } from "./nestedRoots";
import type { ReverseSocketServer } from "./reverseSocketTransport";
import {
  acceptWithProcessExit,
  listenForServer,
} from "./reverseSocketTransport";

/** What the transport reads from the client that owns it. */
export interface LspTransportHost {
  readonly compileState: ServerCompileState;
  readonly nestedRoots: ClientNestedRoots | undefined;
  /** Whether the client is stopping or stopped; its notifications are then dropped. */
  readonly isInactive: () => boolean;
  readonly isDisposed: () => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  /** Called with the generation of a transport whose server process or connection stopped. */
  readonly onUnexpectedStop: (generation: number) => void;
}

/** One `dbt lsp` process, its reverse socket and the language client connected to them. */
export class LspTransport {
  private client: ClientHandle | undefined;
  private converters: LanguageClientOptions["uriConverters"];
  private generation = 0;
  private deletionWatcher: Disposable | undefined;
  private reverseSocket: ReverseSocketServer | undefined;
  private childProcess: SpawnedLspProcess | undefined;
  private stateListener: Disposable | undefined;
  private processExitListener: (() => void) | undefined;
  private readonly options: FusionClientOptions;
  private readonly deps: FusionLanguageClientDependencies;
  private readonly host: LspTransportHost;

  /** The language client of the running transport, if one is connected. */
  get languageClient(): ClientHandle | undefined {
    return this.client;
  }

  get uriConverters(): LanguageClientOptions["uriConverters"] {
    return this.converters;
  }

  /** Counts the transports started; a stop reported by an earlier transport is ignored. */
  get transportGeneration(): number {
    return this.generation;
  }

  constructor(
    options: FusionClientOptions,
    deps: FusionLanguageClientDependencies,
    host: LspTransportHost,
  ) {
    this.options = options;
    this.deps = deps;
    this.host = host;
  }

  private get outputChannel(): LogOutputChannel {
    return this.options.outputChannel;
  }

  async startTransport(): Promise<void> {
    const listen = this.deps.listenForServer ?? listenForServer;
    const accept = this.deps.acceptWithProcessExit ?? acceptWithProcessExit;
    const spawnServer = this.deps.spawnProcess ?? defaultSpawn;

    const { launch } = this.options;
    const selector = documentSelectorForProject(this.options.project.root);
    const { launchRoot, uriConverters } = canonicalProjectRoot(
      this.options.project.root.fsPath,
    );
    this.converters = uriConverters;
    const diagnosticsFilter = new ProjectDiagnosticsFilter([
      this.options.project.root.fsPath,
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
      const env = lspProcessEnv(launch.environment, this.options.env);

      const child = spawnServer({
        executable: this.options.executable.path,
        args,
        env,
        cwd: launchRoot,
      });
      const processAdapter = new SpawnedLspProcess(child, (line) => {
        this.outputChannel.appendLine(line);
      });
      this.childProcess = processAdapter;

      const createLanguageClient =
        this.deps.createLanguageClient ?? defaultCreateLanguageClient;

      const serverOptions: ServerOptions = async () => {
        return accept(server, processAdapter, BOUNDS.connectionTimeoutMs);
      };

      // vscode-languageclient ProgressFeature owns window workDone progress UI.
      const client = await createLanguageClient(
        languageClientIdForProject(this.options.project),
        `dbt Fusion (${this.options.project.name})`,
        serverOptions,
        languageClientOptions({
          project: this.options.project,
          targetPath: this.options.targetPath,
          selector,
          uriConverters,
          outputChannel: this.outputChannel,
          diagnosticsFilter,
          config: launch,
          compileState: this.host.compileState,
          nestedRoots: this.host.nestedRoots,
          isInactive: this.host.isInactive,
        }),
      );

      this.client = client;
      this.deletionWatcher = clearDiagnosticsOnDelete(
        this.options.project.root,
        () => client.diagnostics,
      );
      subscribeToCompileState(client, this.host.compileState);
      await client.start();

      const generation = (this.generation += 1);
      this.stateListener?.dispose();
      this.processExitListener = () => {
        this.host.onUnexpectedStop(generation);
      };
      this.stateListener = client.onDidChangeState((event) => {
        if (event.newState === State.Stopped && !this.host.isDisposed()) {
          this.host.onUnexpectedStop(generation);
        }
      });
      processAdapter.on("exit", this.processExitListener);
    } catch (error) {
      await this.teardownTransport();
      throw error;
    }
  }

  async teardownTransport(): Promise<void> {
    this.stateListener?.dispose();
    this.stateListener = undefined;
    this.host.nestedRoots?.openDocuments.clear();

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
      graceMs: BOUNDS.disposalGraceMs,
      sleep: (ms) => this.host.sleep(ms),
      warn: (message) => this.outputChannel.warn(message),
      name: this.options.project.name,
    });
  }

  /** Closes a document that moved to a nested root, and drops the diagnostics this server published for it. */
  release(uri: Uri): void {
    this.client?.diagnostics?.delete(uri);
    const protocol = this.converters?.code2Protocol(uri) ?? uri.toString();
    const textDocument = { uri: protocol };
    this.client
      ?.sendNotification("textDocument/didClose", { textDocument })
      .catch((error: unknown) => {
        this.outputChannel.warn(
          `Could not close a document moved to a nested root: ${errorText(error)}`,
        );
      });
  }

  private async shutdownLanguageClient(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.client = undefined;
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
}
