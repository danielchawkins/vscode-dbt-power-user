import { relative as relativePath, sep } from "node:path";
import type { Uri } from "vscode";
import type { QueryExecutionResult } from "../../core/dbt/domain";
import type { Log } from "../../core/log";
import { dbColumnsFrom } from "../../core/lsp/index";
import type { DBColumn } from "../../core/types";
import type { FusionCli } from "../../fusion/fusionCli";
import type { FusionCommands } from "../../fusion/fusionCommands";
import type { Manifest } from "../manifest/manifestTypes";
import { compiledModelSql } from "./compiledModel";
import type { SqlDeps, SqlProject } from "./projectSql";
import { compileOrReport, logQuery, runSqlNow } from "./projectSql";

/** What a project's warehouse and compile operations read from the project. */
export interface WarehouseProject extends SqlProject {
  readonly root: Uri;
  getProjectName(): string;
  readonly manifest: Manifest | undefined;
  readonly lsp: FusionCommands;
  getFusionCli(): FusionCli;
}

/** The compiled SQL of a saved model from the language server; `undefined` before its first compile. */
export function compiledSql(project: WarehouseProject, model: Uri) {
  return compiledModelSql(project.lsp, model);
}

/** Compiles text that has no file, through the CLI. */
export function compileInline(project: WarehouseProject, query: string) {
  return project.getFusionCli().compileInline(query);
}

/** Compiles a saved model through the language server, and unsaved or untitled text through the CLI. */
export function compileQuery(
  project: WarehouseProject,
  query: string,
  model?: Uri,
): Promise<string | undefined> {
  return compileOrReport(
    project,
    async (q) =>
      model && model.scheme !== "untitled"
        ? ((await compiledSql(project, model)) ?? compileInline(project, q))
        : compileInline(project, q),
    query,
  );
}

/**
 * A model's columns: from the language server when it knows them, else from the warehouse through the CLI (always
 * in `baseline`, where the server returns none).
 */
export async function columnsOfModel(
  project: WarehouseProject,
  log: Log,
  modelName: string,
): Promise<DBColumn[]> {
  const path = project.manifest?.nodeMetaMap.lookupByBaseName(modelName)?.path;
  if (path) {
    const relative = relativePath(project.root.fsPath, path)
      .split(sep)
      .join("/");
    try {
      const columns = dbColumnsFrom(
        await project.lsp.getCurrentNode(relative, { purpose: "columns" }),
      );
      if (columns) {
        return columns;
      }
    } catch (error) {
      log.debug("Project", "getCurrentNode failed", error);
    }
  }
  return project.getFusionCli().getColumnsOfModel(modelName);
}

/** Runs `query` now, with a row limit, after checking project diagnostics. */
export async function runNow({
  deps,
  query,
  modelName,
  limit,
}: {
  deps: SqlDeps;
  query: string;
  modelName: string;
  limit: number;
}): Promise<QueryExecutionResult> {
  deps.project.throwDiagnosticsErrorIfAvailable();
  logQuery(deps, query, limit);
  return runSqlNow(deps.project.getFusionCli(), { query, modelName, limit });
}
