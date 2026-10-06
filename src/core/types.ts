export interface EnvironmentVariables {
  [key: string]: string | undefined;
}

export type DBColumn = { column: string; dtype: string };

export interface CommandProcessResult {
  stdout: string;
  stderr: string;
  fullOutput: string;
  /** Null when the process was ended by a signal. */
  exitCode?: number | null;
}
