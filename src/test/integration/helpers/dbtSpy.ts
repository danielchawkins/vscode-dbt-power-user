import * as fs from "fs";

/** Environment variable naming the log the integration runner's `dbt` wrapper appends to. */
export const DBT_SPY_LOG_ENV = "FPU_DBT_SPY_LOG";

/** Every `dbt` invocation since the run started, as `<epoch ms> <argv>`; empty when no wrapper is installed. */
export function dbtInvocations(): string[] {
  const log = process.env[DBT_SPY_LOG_ENV];
  if (!log || !fs.existsSync(log)) {
    return [];
  }
  return fs.readFileSync(log, "utf-8").split("\n").filter(Boolean);
}

/** Invocations after the first `since` ones whose first argument is `command`. */
export function dbtInvocationsSince(since: number, command: string): string[] {
  return dbtInvocations()
    .slice(since)
    .filter((line) => line.split(" ")[1] === command);
}
