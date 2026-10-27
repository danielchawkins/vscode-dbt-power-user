import type { Event, LogOutputChannel } from "vscode";
import { EventEmitter } from "vscode";
import type { StaticAnalysisMode } from "../core/snapshot";
import { ServerCompileState } from "./compileSignal";
import type {
  FusionClient,
  FusionClientState,
  FusionProjectRef,
} from "./fusionClient";

/** A client for a project whose server could not be launched; it never runs. */
export class FailedFusionClient implements FusionClient {
  private readonly _onDidChangeState = new EventEmitter<FusionClientState>();
  readonly state: FusionClientState = "failed";
  /** Idle for good: the server never runs, so no compile finishes. */
  readonly compileState = new ServerCompileState();
  readonly staticAnalysis: StaticAnalysisMode;
  readonly failureReason: string;
  readonly project: FusionProjectRef;
  private readonly message: string;
  readonly outputChannel: LogOutputChannel;

  /** Writes `message` to `outputChannel`, which it never disposes. */
  constructor({
    project,
    message,
    staticAnalysis,
    outputChannel,
  }: {
    project: FusionProjectRef;
    message: string;
    staticAnalysis: StaticAnalysisMode;
    outputChannel: LogOutputChannel;
  }) {
    this.project = project;
    this.message = message;
    this.outputChannel = outputChannel;
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
