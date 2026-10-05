import { Event, EventEmitter, LogOutputChannel } from "vscode";
import type { StaticAnalysisMode } from "../core/project";
import type {
  FusionClient,
  FusionClientState,
  FusionProjectRef,
} from "./fusionLanguageClient";

/** A client for a project whose server could not be launched; it never runs. */
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
