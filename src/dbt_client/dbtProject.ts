import { existsSync, writeFileSync } from "fs";

import {
  Catalog,
  ColumnMetaData,
  DBColumn,
  DBT_PROJECT_FILE,
  DBTCommand,
  DBTCommandExecution,
  DBTCommandFactory,
  DBTDiagnosticData,
  DBTNode,
  DBTProjectIntegration,
  DBTTerminal,
  DeferConfig,
  extractOutputColumns,
  isResourceHasDbColumns,
  isResourceNode,
  NodeMetaData,
  ParsedManifest,
  PythonException,
  QueryExecutionResult,
  RESOURCE_TYPE_MODEL,
  RESOURCE_TYPE_SOURCE,
  RunModelParams,
  RunResultsEventData,
  SourceNode,
} from "@altimateai/dbt-integration";
import { inject } from "inversify";
import * as path from "path";
import {
  commands,
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Disposable,
  Event,
  EventEmitter,
  languages,
  ProgressLocation,
  Range,
  RelativePattern,
  Uri,
  ViewColumn,
  window,
  workspace,
} from "vscode";
import { ModelNode } from "../local/lineageTypes";
import { RunHistoryService } from "../services/runHistoryService";
import { SharedStateService } from "../services/sharedStateService";
import {
  getColumnNameByCase,
  getProjectRelativePath,
  resolveSettingsVariables,
} from "../utils";
import { DBTProjectLog } from "./dbtProjectLog";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
  RebuildManifestStatusChange,
} from "./event/manifestCacheChangedEvent";
import { ProjectConfigChangedEvent } from "./event/projectConfigChangedEvent";
import { RunResultsEvent } from "./event/runResultsEvent";
import {
  FusionProjectIntegration,
  FusionProjectIntegrationEvents,
} from "./fusionProjectIntegration";
import { PythonEnvironment } from "./pythonEnvironment";

interface FileNameTemplateMap {
  [key: string]: string;
}

interface JsonObj {
  [key: string]: string | number | undefined;
}

export class DBTProject implements Disposable {
  private static readonly publicationEpochs = new Map<string, number>();
  private _manifestCacheEvent?: ManifestCacheProjectAddedEvent;
  readonly projectRoot: Uri;
  private dbtProjectIntegration: FusionProjectIntegration;

  private _onProjectConfigChanged =
    new EventEmitter<ProjectConfigChangedEvent>();
  public onProjectConfigChanged = this._onProjectConfigChanged.event;
  private _onRunResults = new EventEmitter<RunResultsEvent>();
  public onRunResults = this._onRunResults.event;
  private _onSourceFileChanged = new EventEmitter<void>();
  public onSourceFileChanged = this._onSourceFileChanged.event;
  private dbtProjectLog?: DBTProjectLog;
  public readonly pythonBridgeDiagnostics =
    languages.createDiagnosticCollection("dbt-python-bridge");
  public readonly rebuildManifestDiagnostics =
    languages.createDiagnosticCollection("dbt-rebuild-manifest");
  public readonly projectConfigDiagnostics =
    languages.createDiagnosticCollection("dbt-project-config");
  private disposables: Disposable[] = [
    this._onProjectConfigChanged,
    this._onSourceFileChanged,
    this.pythonBridgeDiagnostics,
    this.rebuildManifestDiagnostics,
    this.projectConfigDiagnostics,
  ];
  private _onRebuildManifestStatusChange =
    new EventEmitter<RebuildManifestStatusChange>();
  readonly onRebuildManifestStatusChange =
    this._onRebuildManifestStatusChange.event;

  /** Emits complete manifest metadata publications. */
  get onManifestChanged(): Event<ManifestCacheChangedEvent> {
    return this._onManifestChanged.event;
  }

  /** Returns the latest complete metadata publication. */
  getMetadataSnapshot(): ManifestCacheProjectAddedEvent | undefined {
    return this._manifestCacheEvent;
  }

  private dbSchemaCache: Record<string, ModelNode> = {};
  private queues: Map<string, DBTCommandExecution[]> = new Map<
    string,
    DBTCommandExecution[]
  >();
  private queueStates: Map<string, boolean> = new Map<string, boolean>();

  constructor(
    @inject(PythonEnvironment)
    private PythonEnvironment: PythonEnvironment,
    @inject("Factory<DBTProjectLog>")
    private dbtProjectLogFactory: (
      onProjectConfigChanged: Event<ProjectConfigChangedEvent>,
    ) => DBTProjectLog,
    private dbtCommandFactory: DBTCommandFactory,
    private terminal: DBTTerminal,
    private eventEmitterService: SharedStateService,
    private dbtIntegrationAdapterFactory: (
      projectRoot: string,
      deferConfig: DeferConfig | undefined,
    ) => FusionProjectIntegration,
    private runHistoryService: RunHistoryService,
    path: Uri,
    private _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
  ) {
    this.projectRoot = path;

    this.dbtProjectLog = this.dbtProjectLogFactory(this.onProjectConfigChanged);

    // Create the integration adapter which will handle the integration selection internally
    this.dbtProjectIntegration = this.dbtIntegrationAdapterFactory(
      this.projectRoot.fsPath,
      this.retrieveDeferConfigFromSettings(),
    );

    // Set up Node.js watcher events to emit VSCode events directly
    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED,
      () => {
        this.terminal.debug(
          "DBTProject",
          "Received sourceFileChanged event from Node.js file watchers",
        );
        this._onSourceFileChanged.fire();
      },
    );

    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED,
      () => {
        this.terminal.debug(
          "DBTProject",
          "Received projectConfigChanged event from Node.js project config watcher",
        );
        const event = new ProjectConfigChangedEvent(this);
        this._onProjectConfigChanged.fire(event);
      },
    );

    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE,
      (status: { inProgress: boolean }) => {
        this.terminal.debug(
          "DBTProject",
          `Received rebuildManifestStatusChange event: inProgress=${status.inProgress}`,
        );
        const event: RebuildManifestStatusChange = {
          project: this,
          inProgress: status.inProgress,
        };
        this._onRebuildManifestStatusChange.fire(event);
      },
    );

    // Handle manifestCreated events from dbtIntegrationAdapter
    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.MANIFEST_PARSED,
      (parsedManifest: ParsedManifest) => {
        this.terminal.debug(
          "DBTProject",
          "Received manifestParsed event from dbtIntegrationAdapter",
        );
        const projectKey = this.projectRoot.fsPath;
        const publicationEpoch =
          (DBTProject.publicationEpochs.get(projectKey) ?? 0) + 1;
        const manifestCacheEvent: ManifestCacheProjectAddedEvent = {
          project: this,
          nodeMetaMap: parsedManifest.nodeMetaMap,
          macroMetaMap: parsedManifest.macroMetaMap,
          metricMetaMap: parsedManifest.metricMetaMap,
          sourceMetaMap: parsedManifest.sourceMetaMap,
          graphMetaMap: parsedManifest.graphMetaMap,
          testMetaMap: parsedManifest.testMetaMap,
          unitTestMetaMap: parsedManifest.unitTestMetaMap,
          docMetaMap: parsedManifest.docMetaMap,
          exposureMetaMap: parsedManifest.exposureMetaMap,
          functionMetaMap: parsedManifest.functionMetaMap,
          semanticModelMetaMap: parsedManifest.semanticModelMetaMap,
          modelDepthMap: parsedManifest.modelDepthMap,
          publicationEpoch,
          metadataProducer: "manifest",
        };
        DBTProject.publicationEpochs.set(projectKey, publicationEpoch);
        this._manifestCacheEvent = manifestCacheEvent;
        this._onManifestChanged.fire({ added: [manifestCacheEvent] });
      },
    );

    // Handle runResultsCreated events from dbtIntegrationAdapter
    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.RUN_RESULTS_PARSED,
      (eventData: RunResultsEventData) => {
        this.terminal.debug(
          "DBTProject",
          "Received runResultsParsed event from dbtIntegrationAdapter",
        );

        this.runHistoryService.addEntry(eventData);

        const uniqueIds = eventData.results.map((r) => r.uniqueId);
        const runResultsEvent = new RunResultsEvent(this, uniqueIds);
        this._onRunResults.fire(runResultsEvent);
      },
    );

    // Handle diagnosticsChanged events from dbtIntegrationAdapter
    this.dbtProjectIntegration.on(
      FusionProjectIntegrationEvents.DIAGNOSTICS_CHANGED,
      () => {
        this.terminal.debug(
          "DBTProject",
          "Received diagnosticsChanged event from dbtIntegrationAdapter",
        );
        this.updateDiagnosticsInProblemsPanel();
      },
    );

    this.disposables.push(
      this.dbtProjectIntegration,
      this._onManifestChanged.event((event) => {
        const addedEvent = event.added?.find(
          (e) => e.project.projectRoot === this.projectRoot,
        );
        if (addedEvent) {
          this._manifestCacheEvent = addedEvent;
        }
      }),
      this.onRunResults((event) => {
        this.invalidateCacheUsingUniqueIds(event.uniqueIds || []);
      }),
    );

    // Initialize Python environment and set up change listener
    this.initializePythonEnvironmentListener();

    this.terminal.debug(
      "DbtProject",
      `Created fusion dbt project ${this.getProjectName()} at ${
        this.projectRoot
      }`,
    );
  }

  private initializePythonEnvironmentListener(): void {
    this.PythonEnvironment.initialize()
      .then(() => {
        this.disposables.push(
          this.PythonEnvironment.onPythonEnvironmentChanged(() =>
            this.onPythonEnvironmentChanged(),
          ),
        );
      })
      .catch((err) => {
        this.terminal.error(
          "dbtProject:initializePythonEnvironmentListener",
          "Failed to initialize Python environment listener",
          err,
        );
      });
  }

  private invalidateCacheUsingUniqueIds(uniqueIds: string[]) {
    for (const uniqueId of uniqueIds) {
      if (uniqueId in this.dbSchemaCache) {
        delete this.dbSchemaCache[uniqueId];
      }
    }
  }

  getProjectName() {
    return this.dbtProjectIntegration.getProjectName();
  }

  getProjectRoot() {
    return this.projectRoot.fsPath;
  }

  getDBTProjectFilePath() {
    return path.join(this.projectRoot.fsPath, DBT_PROJECT_FILE);
  }

  getTargetPath() {
    return this.dbtProjectIntegration.getTargetPath();
  }

  getPackageInstallPath() {
    return this.dbtProjectIntegration.getPackageInstallPath();
  }

  getModelPaths() {
    return this.dbtProjectIntegration.getModelPaths();
  }

  getSeedPaths() {
    return this.dbtProjectIntegration.getSeedPaths();
  }

  getMacroPaths() {
    return this.dbtProjectIntegration.getMacroPaths();
  }

  getAllDiagnostic(): Diagnostic[] {
    const integrationDiagnostics =
      this.getCurrentProjectIntegration().getDiagnostics();

    // Convert diagnostic data to VSCode Diagnostics
    const convertedDiagnostics = [
      ...integrationDiagnostics.pythonBridgeDiagnostics.map(
        (data) =>
          new Diagnostic(
            new Range(
              data.range?.startLine || 0,
              data.range?.startColumn || 0,
              data.range?.endLine || 999,
              data.range?.endColumn || 999,
            ),
            data.message,
            this.mapSeverityToVSCode(data.severity),
          ),
      ),
      ...integrationDiagnostics.rebuildManifestDiagnostics.map(
        (data) =>
          new Diagnostic(
            new Range(
              data.range?.startLine || 0,
              data.range?.startColumn || 0,
              data.range?.endLine || 999,
              data.range?.endColumn || 999,
            ),
            data.message,
            this.mapSeverityToVSCode(data.severity),
          ),
      ),
      ...(integrationDiagnostics.projectConfigDiagnostics || []).map(
        (data) =>
          new Diagnostic(
            new Range(
              data.range?.startLine || 0,
              data.range?.startColumn || 0,
              data.range?.endLine || 999,
              data.range?.endColumn || 999,
            ),
            data.message,
            this.mapSeverityToVSCode(data.severity),
          ),
      ),
    ];

    return convertedDiagnostics;
  }

  private mapSeverityToVSCode(severity: string): DiagnosticSeverity {
    switch (severity) {
      case "error":
        return DiagnosticSeverity.Error;
      case "warning":
        return DiagnosticSeverity.Warning;
      case "info":
        return DiagnosticSeverity.Information;
      case "hint":
        return DiagnosticSeverity.Hint;
      default:
        return DiagnosticSeverity.Error;
    }
  }

  private convertDiagnosticDataToVSCode(data: DBTDiagnosticData): Diagnostic {
    const diagnostic = new Diagnostic(
      new Range(
        data.range?.startLine || 0,
        data.range?.startColumn || 0,
        data.range?.endLine || 999,
        data.range?.endColumn || 999,
      ),
      data.message,
      this.mapSeverityToVSCode(data.severity),
    );
    diagnostic.source = "dbt Power User";
    return diagnostic;
  }

  updateDiagnosticsInProblemsPanel(): void {
    const projectURI = Uri.file(
      path.join(this.projectRoot.fsPath, DBT_PROJECT_FILE),
    );
    const integrationDiagnostics =
      this.getCurrentProjectIntegration().getDiagnostics();

    // Update each diagnostic collection separately
    this.pythonBridgeDiagnostics.set(
      projectURI,
      integrationDiagnostics.pythonBridgeDiagnostics.map((data) =>
        this.convertDiagnosticDataToVSCode(data),
      ),
    );

    this.rebuildManifestDiagnostics.set(
      projectURI,
      integrationDiagnostics.rebuildManifestDiagnostics.map((data) =>
        this.convertDiagnosticDataToVSCode(data),
      ),
    );

    this.projectConfigDiagnostics.set(
      projectURI,
      integrationDiagnostics.projectConfigDiagnostics.map((data) =>
        this.convertDiagnosticDataToVSCode(data),
      ),
    );
  }

  async initialize(): Promise<void> {
    // Create command queue for this project
    this.createQueue("all");

    try {
      await this.dbtProjectIntegration.initialize();
    } catch (error) {
      window.showErrorMessage(
        "An unexpected error occured while initializing the dbt project at " +
          this.projectRoot +
          ": " +
          error +
          ".",
      );
    }

    // ensure all watchers are cleaned up
    if (this.dbtProjectLog) {
      this.disposables.push(this.dbtProjectLog);
    }

    this.terminal.debug(
      "DbtProject",
      `Initialized dbt project ${this.getProjectName()} at ${this.projectRoot}`,
    );
  }

  async rebuildManifest(): Promise<void> {
    this.dbtProjectIntegration.rebuildManifest();
  }

  private async onPythonEnvironmentChanged() {
    this.terminal.debug(
      "DbtProject",
      `Python environment for dbt project ${this.getProjectName()} at ${
        this.projectRoot
      } has changed`,
    );
    await this.initialize();
  }

  async refreshProjectConfig(): Promise<void> {
    this.dbtProjectIntegration.refreshProjectConfig();
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    return await this.dbtProjectIntegration.parseManifest();
  }

  getAdapterType() {
    return this.dbtProjectIntegration.getAdapterType() || "unknown";
  }

  findPackageName(uri: Uri): string | undefined {
    const documentPath = uri.path;
    const pathSegments = documentPath
      .replace(new RegExp(this.projectRoot + "/", "g"), "")
      .split("/");
    const packagesInstallPath = this.getPackageInstallPath();
    if (packagesInstallPath && uri.fsPath.startsWith(packagesInstallPath)) {
      return pathSegments[1];
    }
    return undefined;
  }

  contains(uri: Uri) {
    return (
      uri.fsPath === this.projectRoot.fsPath ||
      uri.fsPath.startsWith(this.projectRoot.fsPath + path.sep)
    );
  }

  async runModel(runModelParams: RunModelParams) {
    const runModelCommand =
      this.dbtCommandFactory.createRunModelCommand(runModelParams);
    await this.prepareAndQueue(runModelCommand, () =>
      this.getCurrentProjectIntegration().runModel(runModelCommand),
    );
  }

  async buildModel(runModelParams: RunModelParams) {
    const buildModelCommand =
      this.dbtCommandFactory.createBuildModelCommand(runModelParams);
    await this.prepareAndQueue(buildModelCommand, () =>
      this.getCurrentProjectIntegration().buildModel(buildModelCommand),
    );
  }

  async buildProject() {
    const buildProjectCommand =
      this.dbtCommandFactory.createBuildProjectCommand();
    await this.prepareAndQueue(buildProjectCommand, () =>
      this.getCurrentProjectIntegration().buildProject(buildProjectCommand),
    );
  }

  async runTest(testName: string) {
    const testModelCommand =
      this.dbtCommandFactory.createTestModelCommand(testName);
    await this.prepareAndQueue(testModelCommand, () =>
      this.getCurrentProjectIntegration().runTest(testModelCommand),
    );
  }

  async runModelTest(modelName: string) {
    const testModelCommand =
      this.dbtCommandFactory.createTestModelCommand(modelName);
    await this.prepareAndQueue(testModelCommand, () =>
      this.getCurrentProjectIntegration().runModelTest(testModelCommand),
    );
  }

  async compileModel(runModelParams: RunModelParams) {
    const compileModelCommand =
      this.dbtCommandFactory.createCompileModelCommand(runModelParams);
    const command =
      await this.getCurrentProjectIntegration().compileModel(
        compileModelCommand,
      );
    if (command) {
      this.addCommandToQueue("all", command);
    }
  }

  clean() {
    return this.dbtProjectIntegration.clean();
  }

  debug(focus: boolean = true) {
    return this.dbtProjectIntegration.debug(focus);
  }

  async installDeps() {
    return this.dbtProjectIntegration.installDeps();
  }

  async compileNode(modelName: string): Promise<string | undefined> {
    this.throwDiagnosticsErrorIfAvailable();
    try {
      return await this.dbtProjectIntegration.unsafeCompileNode(modelName);
    } catch (exc: any) {
      if (exc instanceof PythonException) {
        window.showErrorMessage(
          `An error occured while trying to compile your node: ${modelName}` +
            exc.exception.message +
            ".",
        );
        return (
          "Exception: " +
          exc.exception.message +
          "\n\n" +
          "Detailed error information:\n" +
          exc
        );
      }
      // Unknown error
      window.showErrorMessage(
        "Could not compile model " +
          modelName +
          ": " +
          (exc as Error).message +
          ".",
      );
      return "Detailed error information:\n" + exc;
    }
  }

  async unsafeCompileNode(modelName: string): Promise<string | undefined> {
    this.throwDiagnosticsErrorIfAvailable();
    return this.dbtProjectIntegration.unsafeCompileNode(modelName);
  }

  getDBTVersion(): number[] | undefined {
    return this.getCurrentProjectIntegration().getVersion();
  }

  async compileQuery(
    query: string,
    originalModelName: string | undefined = undefined,
  ): Promise<string | undefined> {
    try {
      return await this.dbtProjectIntegration.unsafeCompileQuery(
        query,
        originalModelName,
      );
    } catch (exc: any) {
      if (exc instanceof PythonException) {
        window.showErrorMessage(
          "An error occured while trying to compile your query: " +
            exc.exception.message +
            ".",
        );
        return undefined;
      }
      // Unknown error
      window.showErrorMessage(
        "Could not compile query: " + (exc as Error).message,
      );
      return undefined;
    }
  }

  showCompiledSql(modelPath: Uri) {
    this.findModelInTargetfolder(modelPath, "compiled");
  }

  showRunSQL(modelPath: Uri) {
    this.findModelInTargetfolder(modelPath, "run");
  }

  createYMLContent(
    columnsInRelation: { [key: string]: string }[],
    modelName: string,
  ): string {
    let yamlString = "version: 2\n\nmodels:\n";
    yamlString += `  - name: ${modelName}\n    description: ""\n    columns:\n`;
    for (const item of columnsInRelation) {
      yamlString += `    - name: ${item.column}\n      description: ""\n`;
    }
    return yamlString;
  }

  async unsafeCompileQuery(
    query: string,
    originalModelName: string | undefined = undefined,
  ) {
    return this.dbtProjectIntegration.unsafeCompileQuery(
      query,
      originalModelName,
    );
  }

  async getColumnsOfModel(modelName: string) {
    const result =
      await this.dbtProjectIntegration.getColumnsOfModel(modelName);
    await this.getCurrentProjectIntegration().cleanupConnections();
    return result;
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    const result = await this.dbtProjectIntegration.getColumnsOfSource(
      sourceName,
      tableName,
    );
    await this.getCurrentProjectIntegration().cleanupConnections();
    return result;
  }

  async getColumnValues(model: string, column: string) {
    try {
      this.terminal.debug(
        "getColumnValues",
        "finding distinct values for column",
        true,
        { model, column },
      );
      const result = await this.dbtProjectIntegration.getColumnValues(
        model,
        column,
      );
      return result;
    } catch (error) {
      throw error;
    } finally {
      await this.getCurrentProjectIntegration().cleanupConnections();
    }
  }

  async getBulkSchemaFromDB(req: DBTNode[], signal: AbortSignal) {
    try {
      const result =
        await this.getCurrentProjectIntegration().getBulkSchemaFromDB(
          req,
          signal,
        );
      await this.getCurrentProjectIntegration().cleanupConnections();
      return result;
    } finally {
      await this.getCurrentProjectIntegration().cleanupConnections();
    }
  }

  async getCatalog(): Promise<Catalog> {
    try {
      const result = await this.getCurrentProjectIntegration().getCatalog();
      return result;
    } catch (exc: any) {
      if (exc instanceof PythonException) {
        window.showErrorMessage(
          "Some of the scans could not run as connectivity to database for the project " +
            this.getProjectName() +
            " is not available. ",
        );
        return [];
      }
      window.showErrorMessage(
        "Some of the scans could not run as connectivity to database for the project " +
          this.getProjectName() +
          " is not available. ",
      );
      return [];
    } finally {
      await this.getCurrentProjectIntegration().cleanupConnections();
    }
  }

  async generateSchemaYML(modelPath: Uri, modelName: string) {
    try {
      // Create filePath based on model location
      const currentDir = path.dirname(modelPath.fsPath);
      const location = path.join(currentDir, modelName + "_schema.yml");
      if (!existsSync(location)) {
        const columnsInRelation = await this.getColumnsOfModel(modelName);
        // Generate yml file content
        const fileContents = this.createYMLContent(
          columnsInRelation,
          modelName,
        );
        writeFileSync(location, fileContents);
        const doc = await workspace.openTextDocument(Uri.file(location));
        window.showTextDocument(doc);
      } else {
        window.showErrorMessage(
          `A file called ${modelName}_schema.yml already exists in ${currentDir}. If you want to generate the schema yml, please rename the other file or delete it if you want to generate the yml again.`,
        );
      }
    } catch (exc: any) {
      if (exc instanceof PythonException) {
        window.showErrorMessage(
          "An error occured while trying to generate the schema yml " +
            exc.exception.message +
            ".",
        );
      }
      window.showErrorMessage(
        "Could not generate schema yaml: " + (exc as Error).message,
      );
    }
  }

  async generateModel(
    sourceName: string,
    tableName: string,
    sourcePath: string,
  ) {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Generating model...",
        cancellable: false,
      },
      async () => {
        try {
          const prefix = workspace
            .getConfiguration("dbt")
            .get<string>("prefixGenerateModel", "base");

          // Map setting to fileName
          const fileNameTemplateMap: FileNameTemplateMap = {
            "{prefix}_{sourceName}_{tableName}": `${prefix}_${sourceName}_${tableName}`,
            "{prefix}_{sourceName}__{tableName}": `${prefix}_${sourceName}__${tableName}`,
            "{prefix}_{tableName}": `${prefix}_${tableName}`,
            "{tableName}": `${tableName}`,
          };

          // Default filename template
          let fileName = `${prefix}_${sourceName}_${tableName}`;

          const fileNameTemplate = workspace
            .getConfiguration("dbt")
            .get<string>(
              "fileNameTemplateGenerateModel",
              "{prefix}_{sourceName}_{tableName}",
            );

          // Parse setting to fileName
          if (fileNameTemplate in fileNameTemplateMap) {
            fileName = fileNameTemplateMap[fileNameTemplate];
          }
          // Create filePath based on source.yml location
          const location = path.join(sourcePath, fileName + ".sql");
          if (!existsSync(location)) {
            const columnsInRelation = await this.getColumnsOfSource(
              sourceName,
              tableName,
            );
            this.terminal.debug(
              "dbtProject:generateModel",
              `Generating columns for source ${sourceName} and table ${tableName}`,
              columnsInRelation,
            );

            const fileContents = `with source as (
        select * from {{ source('${sourceName}', '${tableName}') }}
  ),
  renamed as (
      select
          ${columnsInRelation
            .map((column) => `{{ adapter.quote("${column.column}") }}`)
            .join(",\n        ")}

      from source
  )
  select * from renamed
    `;
            writeFileSync(location, fileContents);
            const doc = await workspace.openTextDocument(Uri.file(location));
            window.showTextDocument(doc);
          } else {
            window.showErrorMessage(
              `A model called ${fileName} already exists in ${sourcePath}. If you want to generate the model, please rename the other model or delete it if you want to generate the model again.`,
            );
          }
        } catch (exc: any) {
          if (exc instanceof PythonException) {
            window.showErrorMessage(
              "An error occured while trying to generate the model " +
                exc.exception.message,
            );
          }
          window.showErrorMessage(
            "An error occured while trying to generate the model:" + exc + ".",
          );
        }
      },
    );
  }

  async executeSQLOnQueryPanel(query: string, modelName: string) {
    const limit = workspace
      .getConfiguration("dbt")
      .get<number>("queryLimit", 500);
    return this.executeSQLWithLimitOnQueryPanel(query, modelName, limit);
  }

  async executeSQLWithLimitOnQueryPanel(
    query: string,
    modelName: string,
    limit: number,
  ) {
    if (limit <= 0) {
      window.showErrorMessage("Please enter a positive number for query limit");
      return;
    }
    this.terminal.info("executeSQL", "Executed query: " + query, true, {
      adapter: this.getAdapterType(),
      limit: limit.toString(),
    });
    this.eventEmitterService.fire({
      command: "executeQuery",
      payload: {
        query,
        fn: this.dbtProjectIntegration.executeSQLWithLimit(
          query,
          modelName,
          limit,
        ),
        projectName: this.getProjectName(),
      },
    });
  }

  async immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    this.throwDiagnosticsErrorIfAvailable();
    this.terminal.info("executeSQL", "Executed query: " + query, true, {
      adapter: this.getAdapterType(),
      limit: limit.toString(),
    });
    return this.dbtProjectIntegration.immediatelyExecuteSQLWithLimit(
      query,
      modelName,
      limit,
    );
  }

  async executeSQLWithLimit(query: string, modelName: string, limit: number) {
    this.throwDiagnosticsErrorIfAvailable();
    this.terminal.info("executeSQL", "Executed query: " + query, true, {
      adapter: this.getAdapterType(),
      limit: limit.toString(),
    });
    return this.dbtProjectIntegration.executeSQLWithLimit(
      query,
      modelName,
      limit,
    );
  }

  async dispose() {
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async findModelInTargetfolder(modelPath: Uri, type: string) {
    const targetPath = this.getTargetPath();
    if (!targetPath) {
      return;
    }
    const relativePath = path.relative(
      this.projectRoot.fsPath,
      modelPath.fsPath,
    );

    const targetModels = await workspace.findFiles(
      new RelativePattern(targetPath, path.join(type, "**", relativePath)),
    );
    if (targetModels.length > 0) {
      commands.executeCommand("vscode.open", targetModels[0], {
        preview: false,
        preserveFocus: true,
        viewColumn: ViewColumn.Beside,
      });
    }
  }

  static isResourceNode(resourceType: string): boolean {
    return isResourceNode(resourceType);
  }

  static isResourceHasDbColumns(resourceType: string): boolean {
    return isResourceHasDbColumns(resourceType);
  }

  getNonEphemeralParents(keys: string[]): string[] {
    return this.dbtProjectIntegration.getNonEphemeralParents(keys);
  }

  mergeColumnsFromDB(
    node: Pick<ModelNode, "columns">,
    columnsFromDB: DBColumn[],
  ) {
    if (!columnsFromDB || columnsFromDB.length === 0) {
      return false;
    }
    const columnsFromManifest: Record<string, ColumnMetaData> = {};
    Object.entries(node.columns).forEach(([k, v]) => {
      columnsFromManifest[getColumnNameByCase(k, this.getAdapterType())] = v;
    });

    for (const c of columnsFromDB) {
      const columnNameFromDB = getColumnNameByCase(
        c.column,
        this.getAdapterType(),
      );
      const existing_column = columnsFromManifest[columnNameFromDB];
      if (existing_column) {
        existing_column.data_type = (
          existing_column.data_type || c.dtype
        )?.toLowerCase();
        continue;
      }
      node.columns[columnNameFromDB] = {
        name: columnNameFromDB,
        data_type: c.dtype?.toLowerCase(),
        description: "",
        meta: {},
      };
    }
    return true;
  }

  public findPackageVersion(packageName: string) {
    const version =
      this.getCurrentProjectIntegration().findPackageVersion(packageName);
    this.terminal.debug(
      "dbtProject:findPackageVersion",
      `found ${packageName} version: ${version}`,
    );
    return version;
  }

  async getBulkCompiledSql(models: string[]) {
    if (models.length === 0) {
      return {};
    }
    if (!this._manifestCacheEvent) {
      throw new Error("The dbt manifest is not available");
    }
    const { nodeMetaMap } = this._manifestCacheEvent;
    return this.getCurrentProjectIntegration().getBulkCompiledSQL(
      models
        .map((m) => nodeMetaMap.lookupByUniqueId(m))
        .filter(Boolean) as NodeMetaData[],
    );
  }

  async getNodesWithDBColumns(modelsToFetch: string[], signal: AbortSignal) {
    const mappedNode: Record<string, ModelNode> = {};
    const relationsWithoutColumns: string[] = [];
    if (modelsToFetch.length === 0) {
      return { mappedNode, relationsWithoutColumns, mappedCompiledSql: {} };
    }
    if (!this._manifestCacheEvent) {
      throw new Error("The dbt manifest is not available");
    }
    const { nodeMetaMap, sourceMetaMap } = this._manifestCacheEvent;
    const bulkSchemaRequest: DBTNode[] = [];

    for (const key of modelsToFetch) {
      if (this.dbSchemaCache[key]) {
        mappedNode[key] = this.dbSchemaCache[key];
        continue;
      }
      const splits = key.split(".");
      const resource_type = splits[0];
      if (resource_type === RESOURCE_TYPE_SOURCE) {
        const source = sourceMetaMap.get(splits[2]);
        const tableName = splits[3];
        if (!source) {
          continue;
        }
        const table = source?.tables.find((t) => t.name === tableName);
        if (!table) {
          continue;
        }
        bulkSchemaRequest.push({
          unique_id: key,
          name: source.name,
          resource_type,
          table: table.name,
        } as SourceNode);
        const node = {
          database: source.database,
          schema: source.schema,
          name: table.name,
          alias: table.identifier,
          uniqueId: key,
          columns: table.columns,
          path: table.path,
        };
        mappedNode[key] = node;
      } else if (DBTProject.isResourceNode(resource_type)) {
        const node = nodeMetaMap.lookupByUniqueId(key);
        if (!node) {
          continue;
        }
        if (DBTProject.isResourceHasDbColumns(resource_type)) {
          bulkSchemaRequest.push({
            unique_id: key,
            name: node.name,
            resource_type,
          });
        }
        mappedNode[key] = {
          uniqueId: key,
          ...node,
        };
      }
    }

    const dbSchemaRequest = bulkSchemaRequest.filter(
      (r) => r.resource_type !== RESOURCE_TYPE_MODEL,
    );

    const sqlglotSchemaRequest = bulkSchemaRequest.filter(
      (r) => r.resource_type === RESOURCE_TYPE_MODEL,
    );
    let startTime = Date.now();
    const sqlglotSchemaResponse = await this.getBulkCompiledSql(
      sqlglotSchemaRequest.map((r) => r.unique_id),
    );
    const compiledSqlTime = Date.now() - startTime;

    if (signal.aborted) {
      return {
        mappedNode,
        relationsWithoutColumns,
        mappedCompiledSql: sqlglotSchemaResponse,
      };
    }

    const sqlglotSchemas: Record<string, DBColumn[]> = {};
    const dialect = this.getAdapterType();

    startTime = Date.now();
    for (const r of sqlglotSchemaRequest) {
      if (!sqlglotSchemaResponse[r.unique_id]) {
        dbSchemaRequest.push(r);
        continue;
      }

      try {
        const columns = await extractOutputColumns(
          sqlglotSchemaResponse[r.unique_id],
          dialect,
        );
        sqlglotSchemas[r.unique_id] = columns.map((c) => ({
          column: c,
          dtype: "string",
        }));
      } catch (e) {
        this.terminal.warn(
          "sqlglotSchemaFetchingFailed",
          `Error while schema fetching for ${r.unique_id}`,
          true,
          e,
        );
        dbSchemaRequest.push(r);
      }
    }
    const sqlglotSchemaTime = Date.now() - startTime;

    if (signal.aborted) {
      return {
        mappedNode,
        relationsWithoutColumns,
        mappedCompiledSql: sqlglotSchemaResponse,
      };
    }

    startTime = Date.now();
    const dbSchemaResponse =
      await this.getCurrentProjectIntegration().getBulkSchemaFromDB(
        dbSchemaRequest,
        signal,
      );
    const dbFetchTime = Date.now() - startTime;

    const bulkSchemaResponse = { ...dbSchemaResponse, ...sqlglotSchemas };

    for (const key of modelsToFetch) {
      if (!bulkSchemaRequest.find((r) => r.unique_id === key)) {
        continue;
      }
      const node = mappedNode[key];
      if (!node) {
        continue;
      }
      const dbColumnAdded = this.mergeColumnsFromDB(
        node,
        bulkSchemaResponse[key],
      );
      if (!dbColumnAdded) {
        relationsWithoutColumns.push(key);
      } else {
        // only adding to cache when successfully fetched columns from db
        this.dbSchemaCache[key] = mappedNode[key];
      }
    }

    console.log("getNodesWithDBColumnsTimings", {
      compiledSqlTime,
      sqlglotSchemaTime,
      dbFetchTime,
      modelInfosLength: modelsToFetch.length,
    });

    return {
      mappedNode,
      relationsWithoutColumns,
      mappedCompiledSql: sqlglotSchemaResponse,
    };
  }

  async applyDeferConfig(): Promise<void> {
    const deferConfig = this.retrieveDeferConfigFromSettings();
    await this.dbtProjectIntegration.applyDeferConfig(deferConfig);
  }

  throwDiagnosticsErrorIfAvailable() {
    // Check integration diagnostics
    const integrationDiagnostics =
      this.getCurrentProjectIntegration().getDiagnostics();
    const allIntegrationDiagnostics = [
      ...integrationDiagnostics.pythonBridgeDiagnostics,
      ...integrationDiagnostics.rebuildManifestDiagnostics,
    ];

    for (const diagnostic of allIntegrationDiagnostics) {
      if (diagnostic.severity === "error") {
        throw new Error(diagnostic.message);
      }
    }

    // Check VSCode diagnostic collections
    const vscodeCollections: DiagnosticCollection[] = [
      this.pythonBridgeDiagnostics,
      this.rebuildManifestDiagnostics,
      this.projectConfigDiagnostics,
    ];

    for (const diagnosticCollection of vscodeCollections) {
      for (const [_, diagnostics] of diagnosticCollection) {
        const error = diagnostics.find(
          (diagnostic) => diagnostic.severity === DiagnosticSeverity.Error,
        );
        if (error) {
          throw new Error(error.message);
        }
      }
    }
  }

  private retrieveDeferConfigFromSettings(): DeferConfig | undefined {
    const relativePath = getProjectRelativePath(this.projectRoot);
    const currentConfig: Record<string, DeferConfig> = workspace
      .getConfiguration("dbt")
      .get("deferConfigPerProject", {});
    if (currentConfig[relativePath]) {
      const config = currentConfig[relativePath];
      const resolvedManifestPath = config.manifestPathForDeferral
        ? resolveSettingsVariables(
            config.manifestPathForDeferral,
            this.projectRoot,
          )
        : config.manifestPathForDeferral;
      return new DeferConfig(
        config.deferToProduction,
        config.favorState,
        resolvedManifestPath,
        config.manifestPathType,
        config.dbtCoreIntegrationId,
      );
    }
  }

  getDeferConfig(): DeferConfig {
    if (!this.dbtProjectIntegration) {
      throw new Error("DBT Project Integration is not initialized.");
    }
    return this.dbtProjectIntegration.getDeferConfig();
  }

  private createQueue(queueName: string) {
    this.queues.set(queueName, []);
  }

  private formatCommandStatus(command: DBTCommand): string {
    return command
      .getCommandAsString()
      .replace(/\s*--project-dir\s+\S+/g, "")
      .replace(/\s*--profiles-dir\s+\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async prepareAndQueue(
    requestedCommand: DBTCommand,
    prepare: () => Promise<DBTCommand | undefined>,
  ): Promise<void> {
    try {
      const command = await prepare();
      if (command) {
        this.addCommandToQueue("all", command);
      }
    } catch (error) {
      const statusMessage = this.formatCommandStatus(requestedCommand);
      this.runHistoryService.notifyCommandFailed(statusMessage, String(error));
      this.terminal.error(
        "commandPreparationError",
        `Unable to prepare ${statusMessage}`,
        error,
      );
    }
  }

  private addCommandToQueue(queueName: string, command: DBTCommand): void {
    this.queues.get(queueName)!.push({
      command: async (signal) => {
        const before =
          this.dbtProjectIntegration.observeRunResultsBeforeCommand();
        const result = await command.execute(signal);
        this.dbtProjectIntegration.parseRunResultsAfterCommand(before);
        // dbt CLI resolves normally even on failure (CommandProcessExecution.complete()
        // never rejects for non-zero exit). Detect pre-execution failures (compilation
        // errors, config errors) by checking stdout.
        if (result?.stdout?.includes("Encountered an error:")) {
          throw new Error(result.stdout.trim());
        }
      },
      statusMessage: this.formatCommandStatus(command),
      focus: command.focus,
      signal: command.signal,
      showProgress: command.showProgress,
    });
    this.pickCommandToRun(queueName);
  }

  private async pickCommandToRun(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName)!;
    const running = this.queueStates.get(queueName);
    if (!running && queue.length > 0) {
      this.queueStates.set(queueName, true);
      const { command, statusMessage, focus, showProgress } = queue.shift()!;
      const commandExecution = async (signal?: AbortSignal) => {
        try {
          await command(signal);
        } catch (error) {
          this.runHistoryService.notifyCommandFailed(
            statusMessage,
            String(error),
          );
        }
      };

      if (showProgress) {
        await window.withProgress(
          {
            location: focus
              ? ProgressLocation.Notification
              : ProgressLocation.Window,
            cancellable: true,
            title: statusMessage,
          },
          async (_, token) => {
            const abortController = new AbortController();
            token.onCancellationRequested(() => abortController.abort());
            await commandExecution(abortController.signal);
          },
        );
      } else {
        await commandExecution();
      }
      this.queueStates.set(queueName, false);
      this.pickCommandToRun(queueName);
    }
  }

  private getCurrentProjectIntegration(): DBTProjectIntegration {
    return this.dbtProjectIntegration.getCurrentProjectIntegration();
  }

  getPublicationEpoch(): number {
    return this._manifestCacheEvent?.publicationEpoch ?? 0;
  }
}
