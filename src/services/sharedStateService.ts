import { EventEmitter } from "vscode";

/** A command broadcast between webview providers. */
export interface SharedStateEventEmitterProps {
  command: string;
  payload: Record<string, unknown>;
}

export class SharedStateService {
  public eventEmitter;

  public constructor() {
    this.eventEmitter = new EventEmitter<SharedStateEventEmitterProps>();
  }

  public fire(data: SharedStateEventEmitterProps) {
    this.eventEmitter.fire(data);
  }
}
