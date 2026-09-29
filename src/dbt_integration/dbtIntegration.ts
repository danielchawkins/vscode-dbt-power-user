import * as crypto from "crypto";

import { CommandProcessResult } from "../fusion/commandProcessExecution";

export function hashProjectRoot(projectRoot: string) {
  return crypto.createHash("md5").update(projectRoot).digest("hex");
}

export interface DBTCommandExecutionStrategy {
  execute(
    command: DBTCommand,
    signal?: AbortSignal,
  ): Promise<CommandProcessResult>;
}

export class DBTCommand {
  constructor(
    public statusMessage: string,
    public args: string[],
    public focus: boolean = false,
    public showProgress: boolean = false,
    public logToTerminal: boolean = false,
    public executionStrategy?: DBTCommandExecutionStrategy,
    public signal?: AbortSignal,
  ) {}

  getCommandAsString() {
    return "dbt " + this.args.join(" ");
  }

  setExecutionStrategy(executionStrategy: DBTCommandExecutionStrategy) {
    this.executionStrategy = executionStrategy;
  }

  execute(signal?: AbortSignal) {
    if (this.executionStrategy === undefined) {
      throw new Error("Execution strategy is required to run dbt commands");
    }
    return this.executionStrategy.execute(this, signal);
  }
}

export interface ExecuteSQLResult {
  table: {
    column_names: string[];
    column_types: string[];
    rows: unknown[][];
  };
  raw_sql: string;
  compiled_sql: string;
  modelName: string;
}

export class ExecuteSQLError extends Error {
  compiled_sql: string;
  constructor(message: string, compiled_sql: string) {
    super(message);
    this.compiled_sql = compiled_sql;
  }
}

export interface CompilationResult {
  compiled_sql: string;
}

export class QueryExecution {
  constructor(
    private cancelFunc: () => Promise<void>,
    private queryResult: () => Promise<ExecuteSQLResult>,
  ) {}

  cancel(): Promise<void> {
    return this.cancelFunc();
  }

  executeQuery(): Promise<ExecuteSQLResult> {
    return this.queryResult();
  }
}
