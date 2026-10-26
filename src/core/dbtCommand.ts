import type { CommandProcessResult } from "./types";

export interface DBTCommandExecutionStrategy {
  execute(
    command: DBTCommand,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<CommandProcessResult>;
}

export class DBTCommand {
  public statusMessage: string;
  public args: string[];
  public executionStrategy: DBTCommandExecutionStrategy | undefined;

  constructor(statusMessage: string, args: string[]) {
    this.statusMessage = statusMessage;
    this.args = args;
  }

  getCommandAsString() {
    return "dbt " + this.args.join(" ");
  }

  setExecutionStrategy(executionStrategy: DBTCommandExecutionStrategy) {
    this.executionStrategy = executionStrategy;
  }

  execute(signal?: AbortSignal, onOutput?: (chunk: string) => void) {
    if (this.executionStrategy === undefined) {
      throw new Error("Execution strategy is required to run dbt commands");
    }
    return this.executionStrategy.execute(this, signal, onOutput);
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

export class QueryExecution {
  private cancelFunc: () => Promise<void>;
  private queryResult: () => Promise<ExecuteSQLResult>;

  constructor(
    cancelFunc: () => Promise<void>,
    queryResult: () => Promise<ExecuteSQLResult>,
  ) {
    this.cancelFunc = cancelFunc;
    this.queryResult = queryResult;
  }

  cancel(): Promise<void> {
    return this.cancelFunc();
  }

  executeQuery(): Promise<ExecuteSQLResult> {
    return this.queryResult();
  }
}
