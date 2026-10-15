import { EventEmitter } from "node:events";
import { vi } from "vitest";

export const ExecuteCommandRequest = {
  type: { method: "workspace/executeCommand" },
};

export const State = {
  Stopped: 1,
  Running: 2,
  Starting: 3,
  StartFailed: 4,
} as const;
export type State = (typeof State)[keyof typeof State];

export class LanguageClient {
  private readonly stateEmitter = new EventEmitter();
  readonly id: string;
  readonly name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

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
