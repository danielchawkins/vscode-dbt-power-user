import { EventEmitter } from "events";
import { vi } from "vitest";

export const ExecuteCommandRequest = {
  type: { method: "workspace/executeCommand" },
};

export enum State {
  Stopped = 1,
  Running = 2,
  Starting = 3,
  StartFailed = 4,
}

export class LanguageClient {
  private readonly stateEmitter = new EventEmitter();

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  start = vi.fn(() => Promise.resolve());
  stop = vi.fn(() => Promise.resolve());
  dispose = vi.fn();
  sendRequest = vi.fn(() => Promise.resolve(undefined));

  onDidChangeState(listener: (event: { newState: State }) => void) {
    this.stateEmitter.on("state", listener);
    return {
      dispose: () => this.stateEmitter.removeListener("state", listener),
    };
  }
}
