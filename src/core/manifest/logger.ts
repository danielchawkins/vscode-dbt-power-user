/** Debug sink the manifest parsers write to. */
export interface ManifestLogger {
  debug(name: string, message: string, ...args: unknown[]): void;
}
