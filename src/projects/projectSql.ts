import {
  type ExecuteSQLResult,
  QueryExecution,
  type QueryExecutionResult,
} from "../dbt_integration";
import { FusionCli } from "../fusion/fusionCli";

type SqlExecutor = Pick<FusionCli, "executeSQL">;

/**
 * `dbt show --output json` reports no column types; the published integration fabricates
 * the literal string "string" for every column regardless of its real type. Report every
 * column type as unknown here, the one seam both deferred and immediate consumers read
 * through, instead of forwarding that placeholder.
 */
function markColumnTypesUnknown(result: ExecuteSQLResult): ExecuteSQLResult {
  return {
    ...result,
    table: {
      ...result.table,
      // Cast: the library types column_types as string[], but never returns a real type.
      column_types: result.table.column_types.map(
        () => null,
      ) as unknown as string[],
    },
  };
}

/** Strips a trailing semicolon and trailing `LIMIT n`, which overrides `limit` when positive. */
export function normalizeQueryLimit(
  query: string,
  limit: number,
): { query: string; limit: number } {
  let normalizedQuery = query.replace(/;\s*$/, "");
  const limitMatch = /\bLIMIT\s+(\d+)\s*(?:;?\s*(?:--[^\n]*)?\s*)$/i.exec(
    normalizedQuery,
  );
  if (limitMatch) {
    const parsedLimit = parseInt(limitMatch[1], 10);
    if (parsedLimit > 0) {
      limit = parsedLimit;
    }
    normalizedQuery = normalizedQuery.replace(limitMatch[0], "").trim();
  }
  return { query: normalizedQuery, limit };
}

/** Runs `query` against `modelName`; `immediate` awaits and row-shapes the result. */
export async function executeSql(
  cli: SqlExecutor,
  query: string,
  modelName: string,
  limit: number,
  immediate: true,
): Promise<QueryExecutionResult>;
export async function executeSql(
  cli: SqlExecutor,
  query: string,
  modelName: string,
  limit: number,
  immediate: false,
): Promise<QueryExecution>;
export async function executeSql(
  cli: SqlExecutor,
  query: string,
  modelName: string,
  limit: number,
  immediate: boolean,
): Promise<QueryExecution | QueryExecutionResult> {
  const normalized = normalizeQueryLimit(query, limit);
  if (normalized.limit <= 0) {
    throw new Error("Limit must be greater than 0");
  }
  const rawExecution = await cli.executeSQL(
    normalized.query,
    normalized.limit,
    modelName,
  );
  const execution = new QueryExecution(
    () => rawExecution.cancel(),
    async () => markColumnTypesUnknown(await rawExecution.executeQuery()),
  );
  if (!immediate) {
    return execution;
  }
  const result = await execution.executeQuery();
  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = 0; rowIndex < result.table.rows.length; rowIndex++) {
    result.table.rows[rowIndex].forEach((value, columnIndex) => {
      rows[rowIndex] = {
        ...rows[rowIndex],
        [result.table.column_names[columnIndex]]: value,
      };
    });
  }
  return {
    columnNames: result.table.column_names,
    columnTypes: result.table.column_types,
    data: rows,
    rawSql: normalized.query,
    compiledSql: result.compiled_sql,
  };
}

/** Returns up to 100 distinct values of `column` in `model`. */
export async function getColumnValues(
  cli: SqlExecutor,
  model: string,
  column: string,
) {
  const query = `SELECT DISTINCT ${column} FROM {{ ref('${model}') }}`;
  const result = await executeSql(cli, query, model, 100, true);
  return result.data.map((row) => Object.values(row)[0]);
}
