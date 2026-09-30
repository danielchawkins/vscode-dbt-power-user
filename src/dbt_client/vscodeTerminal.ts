import { Disposable, EventEmitter, Terminal, window } from "vscode";
import { DBTTerminal } from "../dbt_integration";
import { stripANSI } from "../utils";

export class VSCodeDBTTerminal implements DBTTerminal {
  private disposables: Disposable[] = [];
  private disposed = false;
  private terminal?: Terminal;
  private readonly writeEmitter = new EventEmitter<string>();
  private outputChannel = window.createOutputChannel(`Log - dbt`, {
    log: true,
  });

  constructor() {}

  async show(status: boolean) {
    if (status) {
      await this.requireTerminal();
      this.terminal!.show(!status);
    }
  }

  log(message: string, ...args: any[]) {
    if (this.disposed) {
      return;
    }
    this.outputChannel.info(stripANSI(message), args);
    console.log(stripANSI(message), args);
    if (this.terminal !== undefined) {
      this.writeEmitter.fire(message);
    }
  }

  trace(message: string) {
    if (this.disposed) {
      return;
    }
    this.outputChannel?.appendLine(stripANSI(message));
    console.log(message);
  }

  debug(name: string, message: string, ...args: any[]) {
    if (this.disposed) {
      return;
    }
    this.outputChannel?.debug(`${name}:${stripANSI(message)}`, args);
    console.debug(message, args);
  }

  info(name: string, message: string, _unused: boolean = true, ...args: any[]) {
    if (this.disposed) {
      return;
    }
    this.outputChannel?.info(`${name}:${stripANSI(message)}`, args);
    console.info(`${name}:${message}`, args);
  }

  warn(name: string, message: string, _unused: boolean = true, ...args: any[]) {
    if (this.disposed) {
      return;
    }
    this.outputChannel?.warn(`${name}:${stripANSI(message)}`, args);
    console.warn(`${name}:${message}`, args);
  }

  error(
    name: string,
    message: string,
    e: Error | unknown,
    _unused = true,
    ...args: any[]
  ) {
    if (this.disposed) {
      return;
    }
    let errorMessage = message;
    if (e instanceof Error) {
      errorMessage = `${message}:${e.message}`;
    } else if (e) {
      errorMessage = `${message}:${e}`;
    }
    this.outputChannel?.error(`${name}:${stripANSI(errorMessage)}`, args);
    console.error(`${name}:${errorMessage}`, args);
  }

  /** Idempotent; later writes are dropped. */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    while (this.disposables.length) {
      const x = this.disposables.pop();
      x?.dispose();
    }
    this.writeEmitter.dispose();
    this.outputChannel.dispose();
  }

  private async requireTerminal() {
    if (this.terminal === undefined) {
      this.terminal = window.createTerminal({
        name: "Tasks - dbt",
        pty: {
          onDidWrite: this.writeEmitter.event,
          open: () => this.writeEmitter.fire(""),
          close: () => {
            this.terminal?.dispose();
            this.terminal = undefined;
          },
        },
      });
      this.disposables.push(this.terminal);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
