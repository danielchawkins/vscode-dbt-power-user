import { window } from "vscode";
import { DBTTerminal } from "../dbt_integration";
import { stripANSI } from "../utils";

export class VSCodeDBTTerminal implements DBTTerminal {
  private disposed = false;
  private outputChannel = window.createOutputChannel(`Log - dbt`, {
    log: true,
  });

  log(message: string, ...args: any[]) {
    if (this.disposed) {
      return;
    }
    this.outputChannel.info(stripANSI(message), args);
    console.log(stripANSI(message), args);
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
    this.outputChannel.dispose();
  }
}
