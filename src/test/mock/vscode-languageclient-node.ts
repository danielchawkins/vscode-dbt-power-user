import { EventEmitter } from "events";

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

  start = jest.fn(() => Promise.resolve());
  stop = jest.fn(() => Promise.resolve());
  dispose = jest.fn();
  sendRequest = jest.fn(() => Promise.resolve(undefined));

  onDidChangeState(listener: (event: { newState: State }) => void) {
    this.stateEmitter.on("state", listener);
    return {
      dispose: () => this.stateEmitter.removeListener("state", listener),
    };
  }
}
