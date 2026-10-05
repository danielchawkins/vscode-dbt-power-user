/** The log port shared by command execution, parsers, and the extension's output channels. */
export interface Log {
  debug(name: string, message: string, ...args: unknown[]): void;
  info(name: string, message: string, ...args: unknown[]): void;
  warn(name: string, message: string, ...args: unknown[]): void;
  error(
    name: string,
    message: string,
    error?: unknown,
    ...args: unknown[]
  ): void;
  /** Raw tool output, written unprefixed. */
  output?(text: string): void;
  dispose(): void;
}
