import type { queryResults } from "@fusion-power-user/webview-contract";
import { type Uri } from "vscode";
import { type QueryExecutionResult } from "../../core/dbt/domain";
import { QueryExecution, type ExecuteSQLResult } from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import type { FusionCli } from "../../fusion/fusionCli";
import { notifyError, type NotifiableProject } from "../output/notifications";

type SqlExecutor = Pick<FusionCli, "executeSQL">;

/** The project state the query wrappers read. */
export interface SqlProject {
  readonly projectRoot: Uri;
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
  /** Set when the query previews one model, so the panel can offer the other preview mode. */
  preview?: queryResults.ModelPreview | undefined;
};

/** What the query panel runs: the SQL, the model it is named after, the row limit, and any model preview. */
export type QueryPanelRun = {
  query: string;
  modelName: string;
  limit: number;
  preview?: queryResults.ModelPreview | undefined;
};

/** One query to run: the SQL, the model it is named after, and the row limit. */
type SqlRequest = Pick<QueryPanelRun, "query" | "modelName" | "limit">;

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
    const parsedLimit = parseInt(limitMatch[1] ?? "", 10);
    if (parsedLimit > 0) {
      limit = parsedLimit;
    }
    normalizedQuery = normalizedQuery.replace(limitMatch[0], "").trim();
  }
  return { query: normalizedQuery, limit };
}

/**
 * Starts `req` on the CLI; the caller runs or cancels the returned execution.
 * @internal
 */
export async function startSql(
  cli: SqlExecutor,
  req: SqlRequest,
): Promise<QueryExecution> {
  const normalized = normalizeQueryLimit(req.query, req.limit);
  if (normalized.limit <= 0) {
    throw new Error("Limit must be greater than 0");
  }
  const rawExecution = await cli.executeSQL(
    normalized.query,
    normalized.limit,
    req.modelName,
  );
  return new QueryExecution(
    () => rawExecution.cancel(),
    async () => markColumnTypesUnknown(await rawExecution.executeQuery()),
  );
}

/** Runs `req` now and row-shapes the result. */
export async function runSqlNow(
  cli: SqlExecutor,
  req: SqlRequest,
): Promise<QueryExecutionResult> {
  const result = await (await startSql(cli, req)).executeQuery();
  const rows: Record<string, unknown>[] = [];
  for (const sourceRow of result.table.rows) {
    const row: Record<string, unknown> = {};
    sourceRow.forEach((value, columnIndex) => {
      row[String(result.table.column_names[columnIndex])] = value;
    });
    rows.push(row);
  }
  return {
    columnNames: result.table.column_names,
    columnTypes: result.table.column_types,
    data: rows,
    rawSql: normalizeQueryLimit(req.query, req.limit).query,
    compiledSql: result.compiled_sql,
  };
}

async function queryExecution(
  project: SqlProject,
  query: string,
  modelName: string,
  limit: number,
): Promise<QueryExecution> {
  return startSql(project.getFusionCli(), { query, modelName, limit });
}

/** Logs `query` and its limit to the terminal, tagged with the adapter. */
export function logQuery(deps: SqlDeps, query: string, limit: number): void {
  deps.terminal.info("executeSQL", "Executed query: " + query, {
    adapter: deps.project.getAdapterType(),
    limit: limit.toString(),
  });
}

/** The query-panel payload for a deferred run; undefined, after a message, when the run's limit is <= 0. */
export function queryPanelPayload(
  deps: SqlDeps,
  { query, modelName, limit, preview }: QueryPanelRun,
): QueryPanelPayload | undefined {
  if (limit <= 0) {
    void notifyError(
      deps.project,
      "Enter a positive number for the query limit",
    );
    return undefined;
  }
  logQuery(deps, query, limit);
  return {
    query,
    fn: queryExecution(deps.project, query, modelName, limit),
    projectName: deps.project.getProjectName(),
    preview,
  };
}

/** Compiles `query`, showing an error message and returning undefined when compilation fails. */
export async function compileOrReport(
  project: NotifiableProject,
  compile: (query: string) => Promise<string | undefined>,
  query: string,
): Promise<string | undefined> {
  try {
    return await compile(query);
  } catch (exc) {
    void notifyError(project, "Could not compile query", exc);
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
  const result = await runSqlNow(cli, { query, modelName: model, limit: 100 });
  return result.data.map((row) => Object.values(row)[0]);
}
