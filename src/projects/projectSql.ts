import { window } from "vscode";
import { type ExecuteSQLResult, QueryExecution } from "../core/dbtCommand";
import type { Log } from "../core/log";
import { type QueryExecutionResult } from "../dbt_integration/domain";
import { FusionCli } from "../fusion/fusionCli";

type SqlExecutor = Pick<FusionCli, "executeSQL">;

/** The project state the query wrappers read. */
interface SqlProject {
  getFusionCli(): SqlExecutor;
  getProjectName(): string;
  getAdapterType(): string;
  throwDiagnosticsErrorIfAvailable(): void;
}

/** The collaborators the query wrappers run against. */
export interface SqlDeps {
  project: SqlProject;
  terminal: Log;
}

/** A deferred query execution the query panel runs. */
export type QueryPanelPayload = {
  query: string;
  fn: Promise<QueryExecution>;
  projectName: string;
};

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

/**
 * Strips a trailing semicolon and trailing `LIMIT n`, which overrides `limit` when positive.
 * @internal
 */
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

/**
 * Runs `query` against `modelName`; `immediate` awaits and row-shapes the result.
 * @internal
 */
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

async function queryExecution(
  project: SqlProject,
  query: string,
  modelName: string,
  limit: number,
): Promise<QueryExecution> {
  return executeSql(project.getFusionCli(), query, modelName, limit, false);
}

function logQuery(deps: SqlDeps, query: string, limit: number): void {
  deps.terminal.info("executeSQL", "Executed query: " + query, {
    adapter: deps.project.getAdapterType(),
    limit: limit.toString(),
  });
}

/** The query-panel payload for a deferred run of `query`; undefined, after a message, when `limit` <= 0. */
export function queryPanelPayload(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
): QueryPanelPayload | undefined {
  if (limit <= 0) {
    void window.showErrorMessage(
      "Please enter a positive number for query limit",
    );
    return undefined;
  }
  logQuery(deps, query, limit);
  return {
    query,
    fn: queryExecution(deps.project, query, modelName, limit),
    projectName: deps.project.getProjectName(),
  };
}

/** Runs `query` after checking project diagnostics; `immediate` awaits and row-shapes the result. */
export async function executeWithLimit(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
  immediate: true,
): Promise<QueryExecutionResult>;
export async function executeWithLimit(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
  immediate: false,
): Promise<QueryExecution>;
export async function executeWithLimit(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
  immediate: boolean,
): Promise<QueryExecution | QueryExecutionResult> {
  deps.project.throwDiagnosticsErrorIfAvailable();
  logQuery(deps, query, limit);
  return immediate
    ? executeSql(deps.project.getFusionCli(), query, modelName, limit, true)
    : queryExecution(deps.project, query, modelName, limit);
}

/** Compiles `query`, showing an error message and returning undefined when compilation fails. */
export async function compileOrReport(
  compile: (query: string) => Promise<string | undefined>,
  query: string,
): Promise<string | undefined> {
  try {
    return await compile(query);
  } catch (exc) {
    void window.showErrorMessage(
      "Could not compile query: " +
        (exc instanceof Error ? exc.message : String(exc)),
    );
    return undefined;
  }
}

/** Returns up to 100 distinct values of `column` in `model`. */
export async function getColumnValues(
  cli: SqlExecutor,
  terminal: Log,
  model: string,
  column: string,
) {
  terminal.debug(
    "getColumnValues",
    "finding distinct values for column",
    true,
    {
      model,
      column,
    },
  );
  const query = `SELECT DISTINCT ${column} FROM {{ ref('${model}') }}`;
  const result = await executeSql(cli, query, model, 100, true);
  return result.data.map((row) => Object.values(row)[0]);
}
