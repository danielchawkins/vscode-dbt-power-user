import { Uri } from "vscode";
import { QueryExecution } from "../core/dbtCommand";
import type { Log } from "../core/log";
import { DBColumn } from "../core/types";
import { QueryExecutionResult } from "../dbt_integration/domain";
import type { FusionCli } from "../fusion/fusionCli";
import type { FusionCommands } from "../fusion/fusionCommands";
import type { ModelNode } from "../local/lineageTypes";
import { readSetting } from "../settings";
import type { Manifest } from "./manifestTypes";
import {
  findModelInTargetfolder,
  generateModel,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "./projectCodegen";
import { getColumnValues, queryPanelPayload, SqlDeps } from "./projectSql";
import {
  columnsOfModel,
  compiledSql,
  compileInline,
  compileQuery,
  runNow,
  startRun,
  type WarehouseProject,
} from "./projectWarehouse";
import type { SharedStateService } from "./sharedStateService";

/** The compile, column and query operations of a project, which run against its CLI and language server. */
export abstract class ProjectQueries implements WarehouseProject {
  abstract readonly projectRoot: Uri;
  protected abstract readonly terminal: Log;
  protected abstract readonly sharedState: SharedStateService;
  abstract readonly lsp: FusionCommands;
  abstract get manifest(): Manifest | undefined;
  abstract getFusionCli(): FusionCli;
  abstract getProjectName(): string;
  abstract getAdapterType(): string;
  abstract getTargetPath(): string | undefined;
  abstract throwDiagnosticsErrorIfAvailable(): void;

  /** Compiles a saved model through the language server, and unsaved or untitled text through the CLI. */
  compileQuery(query: string, model?: Uri): Promise<string | undefined> {
    return compileQuery(this, query, model);
  }

  showRunSQL(modelPath: Uri) {
    const root = this.projectRoot.fsPath;
    void findModelInTargetfolder(root, this.getTargetPath(), modelPath, "run");
  }

  /** The compiled SQL of a saved model from the language server; `undefined` before its first compile. */
  compiledSql(model: Uri): Promise<string | undefined> {
    return compiledSql(this, model);
  }

  /** Compiles text that has no file, through the CLI. */
  async unsafeCompileQuery(query: string) {
    return compileInline(this, query);
  }

  /** A model's columns, from the language server when it knows them, else from the warehouse through the CLI. */
  getColumnsOfModel(modelName: string): Promise<DBColumn[]> {
    return columnsOfModel(this, this.terminal, modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.getFusionCli().getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    return getColumnValues(this.getFusionCli(), this.terminal, model, column);
  }

  generateSchemaYML(modelPath: Uri, modelName: string) {
    return generateSchemaYML(this, modelPath, modelName);
  }

  generateModel(name: string, table: string, sourcePath: string) {
    return generateModel(this, this.terminal, name, table, sourcePath);
  }

  executeSQLOnQueryPanel(query: string, modelName: string) {
    const limit = readSetting("query.limit");
    return this.executeSQLWithLimitOnQueryPanel(query, modelName, limit);
  }

  async executeSQLWithLimitOnQueryPanel(
    query: string,
    modelName: string,
    limit: number,
  ) {
    const payload = queryPanelPayload(this.sqlDeps, query, modelName, limit);
    if (payload) {
      this.sharedState.fire({ command: "executeQuery", payload });
    }
  }

  immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    return runNow(this.sqlDeps, query, modelName, limit);
  }

  executeSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecution> {
    return startRun(this.sqlDeps, query, modelName, limit);
  }

  mergeColumnsFromDB(
    node: Pick<ModelNode, "columns">,
    columnsFromDB: DBColumn[],
  ) {
    return mergeColumnsFromDB(this.getAdapterType(), node, columnsFromDB);
  }

  private get sqlDeps(): SqlDeps {
    return { project: this, terminal: this.terminal };
  }
}
