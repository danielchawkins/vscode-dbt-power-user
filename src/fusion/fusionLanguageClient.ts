import type { CancellationToken, Event, LogOutputChannel, Uri } from "vscode";
import { EventEmitter } from "vscode";
import { type StaticAnalysisMode } from "../core/snapshot";
import { errorText } from "../core/text";
import { projectFileAvailable } from "./clientLifecycle";
import { ServerCompileState } from "./compileSignal";
import {
  MAX_UNEXPECTED_EXIT_RETRIES,
  type FusionClient,
  type FusionClientOptions,
  type FusionClientState,
  type FusionLspCommand,
  type FusionProjectRef,
} from "./fusionClient";
import { FusionRequests } from "./fusionRequests";
import { type FusionLanguageClientDependencies } from "./lspClientSupport";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS } from "./lspProcess";
import { LspTransport } from "./lspTransport";
import { ClientNestedRoots } from "./nestedRoots";

export type { FusionLanguageClientDependencies } from "./lspClientSupport";

/** A Fusion Client over `vscode-languageclient`, which starts `dbt lsp` for one Declared Project. */
export function createFusionLanguageClient(
  options: FusionClientOptions,
  deps: FusionLanguageClientDependencies = {},
): FusionClient {
  return new FusionLanguageClientImpl(options, deps);
}

class FusionLanguageClientImpl implements FusionClient {
  private _state: FusionClientState = "stopped";
  private _failureReason: string | undefined;
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
  private exitAttempts = 0;
  private restartChain: Promise<void> = Promise.resolve();
  private stopPromise: Promise<void> | undefined;
  private disposed = false;
  /** Whether the client is stopping or stopped; its notifications are then dropped. */
  private readonly isInactive = (): boolean =>
    this.stopPromise !== undefined || this._state === "stopped";
  private unexpectedStopHandledGeneration = 0;
  private readonly requests = new FusionRequests(() => ({
    client: this.transport.languageClient,
    state: this._state,
    commandPrefix: this.options.commandPrefix,
    uriConverters: this.transport.uriConverters,
  }));
  private readonly nestedRoots: ClientNestedRoots | undefined;
  private readonly transport: LspTransport;
  private readonly options: FusionClientOptions;
  private readonly deps: FusionLanguageClientDependencies;

  constructor(
    options: FusionClientOptions,
    deps: FusionLanguageClientDependencies,
  ) {
    this.options = options;
    this.deps = deps;
    this.nestedRoots =
      options.nestedRoots &&
      new ClientNestedRoots(options.project.root, options.nestedRoots, (uri) =>
        this.transport.release(uri),
      );
    this.transport = new LspTransport(options, deps, {
      compiled: this.compiled,
      nestedRoots: this.nestedRoots,
      isInactive: this.isInactive,
      isDisposed: () => this.disposed,
      sleep: (ms) => this.sleep(ms),
      onUnexpectedStop: (generation) => this.scheduleUnexpectedStop(generation),
    });
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

  get openDocuments(): readonly Uri[] {
    return this.nestedRoots?.openDocuments.uris ?? [];
  }

  get diagnostics() {
    return this.transport.languageClient?.diagnostics;
  }

  readonly compiled = new ServerCompileState();

  get outputChannel(): LogOutputChannel {
    return this.options.outputChannel;
  }

  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T> {
    return this.requests.request<T>(command, payload, token);
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
    this.nestedRoots?.dispose();
    void this.stop().finally(() => {
      this._onDidChangeState.dispose();
    });
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.doStop();
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
    await this.transport.teardownTransport();

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
    // After the backoff, since the checkout may have gone during it.
    if (!projectFileAvailable(this.options, this.deps.rootExists)) {
      this.setState("stopped");
      return;
    }

    try {
      await this.transport.startTransport();
      this._failureReason = undefined;
      this.setState("running");
    } catch (error) {
      const message = errorText(error);
      if (reason === "unexpected") {
        this.recordFailure(
          `Restart failed for ${this.options.project.name}: ${message}`,
        );
      } else {
        this.recordFailure(
          `Failed to start Fusion LSP for ${this.options.project.name}: ${message}`,
        );
      }
      await this.transport.teardownTransport();
      this.setState("failed");
    }
  }

  private scheduleUnexpectedStop(signalGeneration: number): void {
    if (
      this.disposed ||
      this.stopPromise ||
      this._state !== "running" ||
      signalGeneration !== this.transport.transportGeneration ||
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
      await this.transport.teardownTransport();
      return;
    }
    await this.scheduleRestart("unexpected");
  }

  private async doStop(): Promise<void> {
    await this.restartChain;
    this.setState("stopped");
    await this.transport.teardownTransport();
  }

  private recordFailure(message: string): void {
    this._failureReason ??= message;
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
