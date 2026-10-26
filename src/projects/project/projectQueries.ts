import type { queryResults } from "@fusion-power-user/webview-contract";
import type { Uri } from "vscode";
import type { QueryExecutionResult } from "../../core/dbt/domain";
import type { ModelNode } from "../../core/lineage/modelNode";
import type { Log } from "../../core/log";
import type { ProjectPaths } from "../../core/snapshot/index";
import type { DBColumn } from "../../core/types";
import { readSetting } from "../../settings/index";
import {
  findModelInTargetfolder,
  generateModel,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "./projectCodegen";
import type { QueryPanelRun, SqlDeps } from "./projectSql";
import { getColumnValues, queryPanelPayload } from "./projectSql";
import {
  columnsOfModel,
  compiledSql,
  compileInline,
  compileQuery,
  runNow,
  type WarehouseProject,
} from "./projectWarehouse";
import type { SharedStateService } from "./sharedStateService";

/** What the queries read from their project. */
export interface QueriedProject extends WarehouseProject {
  paths(): Pick<ProjectPaths, "targetPath"> | undefined;
}

/** The compile, column and query operations of a project, which run against its CLI and language server. */
export class ProjectQueries {
  private readonly project: QueriedProject;
  private readonly terminal: Log;
  private readonly sharedState: SharedStateService;

  constructor(
    project: QueriedProject,
    terminal: Log,
    sharedState: SharedStateService,
  ) {
    this.project = project;
    this.terminal = terminal;
    this.sharedState = sharedState;
  }

  /** Compiles a saved model through the language server, and unsaved or untitled text through the CLI. */
  compileQuery(query: string, model?: Uri): Promise<string | undefined> {
    return compileQuery(this.project, query, model);
  }

  showRunSQL(modelPath: Uri) {
    const root = this.project.projectRoot.fsPath;
    void findModelInTargetfolder({
      projectRoot: root,
      targetPath: this.project.paths()?.targetPath,
      modelPath,
      type: "run",
    });
  }

  /** The compiled SQL of a saved model from the language server; `undefined` before its first compile. */
  compiledSql(model: Uri): Promise<string | undefined> {
    return compiledSql(this.project, model);
  }

  /** Compiles text that has no file, through the CLI. */
  async unsafeCompileQuery(query: string) {
    return compileInline(this.project, query);
  }

  /** A model's columns, from the language server when it knows them, else from the warehouse through the CLI. */
  getColumnsOfModel(modelName: string): Promise<DBColumn[]> {
    return columnsOfModel(this.project, this.terminal, modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.project
      .getFusionCli()
      .getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    return getColumnValues({
      cli: this.project.getFusionCli(),
      terminal: this.terminal,
      model,
      column,
    });
  }

  generateSchemaYML(modelPath: Uri, modelName: string) {
    return generateSchemaYML(this.codegen, modelPath, modelName);
  }

  generateModel(name: string, table: string, sourcePath: string) {
    return generateModel({
      columns: this.codegen,
      terminal: this.terminal,
      sourceName: name,
      tableName: table,
      sourcePath,
    });
  }

  executeSQLOnQueryPanel(
    query: string,
    modelName: string,
    preview?: queryResults.ModelPreview,
  ) {
    const limit = readSetting("query.limit");
    return this.runOnQueryPanel({ query, modelName, limit, preview });
  }

  async executeSQLWithLimitOnQueryPanel(
    query: string,
    modelName: string,
    limit: number,
  ) {
    await this.runOnQueryPanel({ query, modelName, limit });
  }

  private async runOnQueryPanel(run: QueryPanelRun) {
    const payload = queryPanelPayload(this.sqlDeps, run);
    if (payload) {
      this.sharedState.fire({ command: "executeQuery", payload });
    }
  }

  immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    return runNow({ deps: this.sqlDeps, query, modelName, limit });
  }

  mergeColumnsFromDB(
    node: Pick<ModelNode, "columns">,
    columnsFromDB: DBColumn[],
  ) {
    return mergeColumnsFromDB(
      this.project.getAdapterType(),
      node,
      columnsFromDB,
    );
  }

  /** The column lookups codegen reads, with the project it names in notifications. */
  private get codegen() {
    return {
      projectRoot: this.project.projectRoot,
      getProjectName: () => this.project.getProjectName(),
      getColumnsOfModel: (modelName: string) =>
        this.getColumnsOfModel(modelName),
      getColumnsOfSource: (sourceName: string, tableName: string) =>
        this.getColumnsOfSource(sourceName, tableName),
    };
  }

  private get sqlDeps(): SqlDeps {
    return { project: this.project, terminal: this.terminal };
  }
}
