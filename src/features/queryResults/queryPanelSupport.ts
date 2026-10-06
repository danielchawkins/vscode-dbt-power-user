import { queryResults } from "@fusion-power-user/webview-contract";
import { TextEditor, window, workspace } from "vscode";
import { ExecuteSQLError } from "../../core/dbtCommand";
import type { Log } from "../../core/log";
import { activeModelUri } from "../../projects/previewUri";
import type { QueryManifestService } from "../../projects/queryManifestService";
import { writeSetting } from "../../settings";
import type { QueryHistoryStore } from "./queryHistory";

type PanelMessage = queryResults.PanelMessage;

/** Perspective fetches and compiles its .wasm, runs its engine in a Blob worker and injects styles. */
export const QUERY_RESULTS_CSP = {
  wasm: true,
  connect: true,
  blobWorkers: true,
  inlineStyles: true,
};

/** The tab data a results tab renders for a history entry. */
export function tabDataOf(entry: queryResults.QueryHistoryEntry) {
  return {
    queryResults: {
      data: entry.data,
      columnNames: entry.columnNames,
      columnTypes: entry.columnTypes,
    },
    compiledCodeMarkup: entry.compiledSql,
    rawSql: entry.rawSql,
    elapsedTime: { queryExecutionInfo: { elapsedTime: entry.duration } },
  };
}

/** The error the page renders for a failed query, and the compiled SQL it shows beside it. */
export function failureOf(exc: unknown, query: string) {
  if (exc instanceof ExecuteSQLError) {
    return {
      error: {
        code: -1,
        message: exc.message,
        data: JSON.stringify(exc.stack, null, 2),
      },
      compiledSql: exc.compiled_sql,
    };
  }
  return {
    error: { code: -1, message: `${exc}`, data: {} },
    compiledSql: query,
  };
}

/** Saves the row limit and the Perspective theme the page changed. */
export function updateQueryConfig({
  limit,
  perspectiveTheme,
}: Extract<PanelMessage, { command: "updateConfig" }>) {
  if (limit !== undefined) {
    void writeSetting("query.limit", limit);
  }
  if (perspectiveTheme !== undefined) {
    void writeSetting("queryResults.theme", perspectiveTheme);
  }
}

/** Opens `code` in an untitled Jinja SQL editor. */
export async function openSqlInEditor(code = ""): Promise<void> {
  const document = await workspace.openTextDocument({
    language: "jinja-sql",
    content: code,
  });
  await window.showTextDocument(document);
}

/** What running a query on the query panel needs from a project. */
interface QueryPanelProject {
  executeSQLWithLimitOnQueryPanel(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<void>;
  executeSQLOnQueryPanel(query: string, modelName: string): Promise<void>;
}

/** The named project, or the one picked from the workspace when there is no name. */
export async function resolveQueryProject(
  queryManifestService: QueryManifestService,
  projectName?: string,
) {
  const project = projectName
    ? queryManifestService.getProjectByName(projectName)
    : await queryManifestService.getOrPickProjectFromWorkspace();
  if (!project) {
    throw new Error("Unable to find project to execute query");
  }
  return project;
}

/** Runs a query from history or bookmarks on the query panel, with its own row limit when it has one. */
export async function runOnQueryPanel(
  project: QueryPanelProject,
  message: { query: string; limit?: number | undefined },
): Promise<void> {
  if (message.limit) {
    await project.executeSQLWithLimitOnQueryPanel(
      message.query,
      "",
      message.limit,
    );
  } else {
    await project.executeSQLOnQueryPanel(message.query, "");
  }
}

/**
 * Adds a result to the history. A query run from history or bookmarks may have no project to attribute it to, and
 * is not recorded.
 */
export function recordResult(
  history: QueryHistoryStore,
  queryManifestService: QueryManifestService,
  log: Pick<Log, "debug">,
  run: {
    result: {
      columnNames: string[];
      columnTypes: (string | null)[];
      rows: Record<string, unknown>[];
      compiled_sql: string;
    };
    projectName: string;
    query: string;
    start: number;
    modelName: string;
  },
): void {
  const project = run.projectName
    ? queryManifestService.getProjectByName(run.projectName)
    : queryManifestService.getProject();
  if (!project) {
    log.debug(
      "updateQueryHistory",
      "skipping query history update, no project found, may be executed from query history",
    );
    return;
  }
  history.add(project, {
    rawSql: run.query,
    compiledSql: run.result.compiled_sql,
    duration: Date.now() - run.start,
    data: run.result.rows,
    columnNames: run.result.columnNames,
    columnTypes: run.result.columnTypes,
    modelName: run.modelName,
  });
}

/** The active editor's query and file, or none when no editor is open. */
export function activeEditorContext(
  editor: TextEditor | undefined,
): queryResults.QueryContext["activeEditor"] {
  return editor
    ? {
        query: editor.document.getText(),
        filepath: activeModelUri(editor.document.uri).fsPath,
      }
    : {};
}
