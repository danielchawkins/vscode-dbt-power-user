import { commands, Disposable } from "vscode";
import {
  ExecuteSQLResult,
  QueryExecution,
} from "../../dbt_integration/dbtIntegration";
import { testCommandsEnabled } from "../../settings";
import { QueryResultPanel } from "./queryResultPanel";

/**
 * Test-only: shows a synthetic result of `rowCount` rows through the host's query path.
 * @internal
 */
export const RENDER_TEST_RESULT_COMMAND =
  "fusionPowerUser.test.renderQueryResult";

/**
 * A five-column result of `rowCount` rows, shaped like an `executeSQL` table.
 * @internal
 */
export function syntheticResult(rowCount: number): ExecuteSQLResult {
  return {
    table: {
      column_names: ["id", "label", "amount", "created_at", "active"],
      column_types: ["Integer", "Text", "Float", "Text", "Boolean"],
      rows: Array.from({ length: rowCount }, (_, i) => [
        i,
        `row ${i}`,
        i * 1.5,
        `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
        i % 2 === 0,
      ]),
    },
    raw_sql: "select synthetic",
    compiled_sql: "select synthetic",
    modelName: "synthetic",
  };
}

/** Registers {@link RENDER_TEST_RESULT_COMMAND} when a test harness runs. */
export function registerQueryResultTestCommand(
  panel: QueryResultPanel,
): Disposable | undefined {
  if (!testCommandsEnabled()) {
    return undefined;
  }
  return commands.registerCommand(
    RENDER_TEST_RESULT_COMMAND,
    async (rowCount: number) => {
      const execution = new QueryExecution(
        async () => undefined,
        async () => syntheticResult(rowCount),
      );
      await panel.executeQuery(
        "select synthetic",
        Promise.resolve(execution),
        "",
      );
    },
  );
}
