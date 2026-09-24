/** Output sink shared by command execution, parsers, and the extension's log channel. */
export interface DBTTerminal {
  show(status: boolean): Promise<void>;
  log(message: string, ...args: unknown[]): void;
  trace(message: string): void;
  debug(name: string, message: string, ...args: unknown[]): void;
  info(
    name: string,
    message: string,
    sendTelemetry?: boolean,
    ...args: unknown[]
  ): void;
  warn(
    name: string,
    message: string,
    sendTelemetry?: boolean,
    ...args: unknown[]
  ): void;
  error(
    name: string,
    message: string,
    e: unknown,
    sendTelemetry?: boolean,
    ...args: unknown[]
  ): void;
  dispose(): void;
}
