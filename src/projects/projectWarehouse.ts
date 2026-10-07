import { relative as relativePath, sep } from "path";
import { Uri } from "vscode";
import { QueryExecution } from "../core/dbtCommand";
import type { Log } from "../core/log";
import { dbColumnsFrom } from "../core/lsp";
import { DBColumn } from "../core/types";
import { QueryExecutionResult } from "../dbt_integration/domain";
import type { FusionCli } from "../fusion/fusionCli";
import type { FusionCommands } from "../fusion/fusionCommands";
import { compiledModelSql } from "./compiledModel";
import type { Manifest } from "./manifestTypes";
import {
  compileOrReport,
  executeWithLimit,
  SqlDeps,
  SqlProject,
} from "./projectSql";

/** What a project's warehouse and compile operations read from the project. */
export interface WarehouseProject extends SqlProject {
  readonly projectRoot: Uri;
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
    const relative = relativePath(project.projectRoot.fsPath, path)
      .split(sep)
      .join("/");
    try {
      const columns = dbColumnsFrom(await project.lsp.getCurrentNode(relative));
      if (columns) {
        return columns;
      }
    } catch (error) {
      log.debug("Project", "getCurrentNode failed", error);
    }
  }
  return project.getFusionCli().getColumnsOfModel(modelName);
}

/** Runs `query` now, with a row limit. */
export function runNow(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
): Promise<QueryExecutionResult> {
  return executeWithLimit(deps, query, modelName, limit, true);
}

/** Starts `query` with a row limit; the caller runs or cancels the returned execution. */
export function startRun(
  deps: SqlDeps,
  query: string,
  modelName: string,
  limit: number,
): Promise<QueryExecution> {
  return executeWithLimit(deps, query, modelName, limit, false);
}
