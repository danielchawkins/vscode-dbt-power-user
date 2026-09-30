import { existsSync, writeFileSync } from "fs";

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
import { commandParamsFor } from "../core/cli";
import {
  dbtProjectFilePath,
  readDbtProjectFile,
  ResolvedDefer,
} from "../core/project";
import {
  ColumnMetaData,
  DBColumn,
  DBTCommand,
  DBTDiagnosticData,
  DBTTerminal,
  ParsedManifest,
  QueryExecutionResult,
  RunModelParams,
} from "../dbt_integration";
import { FusionCli, QueuedCliCommand } from "../fusion/fusionCli";
import {
  hasProjectStrictAnalysis,
  resolveSchemaOrigin,
  SchemaOriginStatus,
} from "../fusion/schemaOrigin";
import { ModelNode } from "../local/lineageTypes";
import { CommandQueue, formatCommandStatus } from "../projects/commandQueue";
import { readProjectSnapshot } from "../projects/readProjectSnapshot";
import {
  RunResultsHistory,
  RunResultsReader,
  withRunResults,
} from "../projects/runResults";
import { RunHistoryService } from "../services/runHistoryService";
import { SharedStateService } from "../services/sharedStateService";
import { readSetting } from "../settings";
import { getColumnNameByCase } from "../utils";
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
function selection(params: RunModelParams): string {
  return `${params.plusOperatorLeft}${params.modelName}${params.plusOperatorRight}`;
}

/** The status line for a command that could not be prepared: its selection and `commandParams`. */
function formatCliStatus(
  cli: QueuedCliCommand,
  params: readonly string[],
): string {
  const body =
    cli.kind === "build" && cli.select === undefined
      ? "dbt build"
      : `dbt ${cli.kind} --select ${cli.select}`;
  return [body, ...params].join(" ");
}

interface FileNameTemplateMap {
  [key: string]: string;
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
  public readonly rebuildManifestDiagnostics =
    languages.createDiagnosticCollection("dbt-rebuild-manifest");
  public readonly projectConfigDiagnostics =
    languages.createDiagnosticCollection("dbt-project-config");
  private disposables: Disposable[] = [
    this._onProjectConfigChanged,
    this._onSourceFileChanged,
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

  private readonly commandQueue = new CommandQueue();
  private readonly runResultsReader: RunResultsReader;
  private readonly runHistory: RunResultsHistory = {
    addEntry: (entry) => {
      this.runHistoryService.addEntry(entry);
      const uniqueIds = entry.results.map((r) => r.uniqueId);
      this._onRunResults.fire(new RunResultsEvent(this, uniqueIds));
    },
  };

  constructor(
    @inject("Factory<DBTProjectLog>")
    private dbtProjectLogFactory: (
      onProjectConfigChanged: Event<ProjectConfigChangedEvent>,
    ) => DBTProjectLog,
    private terminal: DBTTerminal,
    private eventEmitterService: SharedStateService,
    private dbtIntegrationAdapterFactory: (
      projectRoot: string,
    ) => FusionProjectIntegration,
    private runHistoryService: RunHistoryService,
    path: Uri,
    private _onManifestChanged: EventEmitter<ManifestCacheChangedEvent>,
  ) {
    this.projectRoot = path;
    this.disposables.push(
      this.commandQueue,
      this.commandQueue.onFailed(({ statusMessage, error }) =>
        this.runHistoryService.notifyCommandFailed(
          statusMessage,
          String(error),
        ),
      ),
    );

    this.dbtProjectLog = this.dbtProjectLogFactory(this.onProjectConfigChanged);

    // Create the integration adapter which will handle the integration selection internally
    this.dbtProjectIntegration = this.dbtIntegrationAdapterFactory(
      this.projectRoot.fsPath,
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

    this.runResultsReader = new RunResultsReader(
      () => this.dbtProjectIntegration.getTargetPath(),
      () => this.dbtProjectIntegration.getProjectName(),
      this.terminal,
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
    );

    this.terminal.debug(
      "DbtProject",
      `Created fusion dbt project ${this.getProjectName()} at ${
        this.projectRoot
      }`,
    );
  }

  getProjectName() {
    return this.dbtProjectIntegration.getProjectName();
  }

  getProjectRoot() {
    return this.projectRoot.fsPath;
  }

  getDBTProjectFilePath() {
    return dbtProjectFilePath(this.projectRoot.fsPath);
  }

  /** Version of the committed Fusion executable; undefined until one is committed. */
  getFusionVersion() {
    return this.dbtProjectIntegration.getFusionVersion();
  }

  /** Whether strict analysis of this project can run without the warehouse; see `resolveSchemaOrigin`. */
  schemaOriginStatus(
    fusionVersion = this.dbtProjectIntegration.getFusionVersion(),
  ): SchemaOriginStatus {
    return resolveSchemaOrigin({
      projectConfig: readDbtProjectFile(this.projectRoot.fsPath).config,
      fusionVersion,
      sources: this._manifestCacheEvent?.sourceMetaMap ?? new Map(),
    });
  }

  /** The column-lineage opt-ins this project has made in its own project file; none when it is unreadable. */
  projectOptIns(): { strict: boolean; schemaOrigin: SchemaOriginStatus } {
    const projectConfig = readDbtProjectFile(this.projectRoot.fsPath).config;
    return {
      strict: hasProjectStrictAnalysis(projectConfig),
      schemaOrigin: this.schemaOriginStatus(),
    };
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
    const integrationDiagnostics = this.dbtProjectIntegration.getDiagnostics();

    // Convert diagnostic data to VSCode Diagnostics
    const convertedDiagnostics = [
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
    diagnostic.source = "Fusion Power User";
    return diagnostic;
  }

  updateDiagnosticsInProblemsPanel(): void {
    const projectURI = Uri.file(this.getDBTProjectFilePath());
    const integrationDiagnostics = this.dbtProjectIntegration.getDiagnostics();

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

  async runModel(params: RunModelParams) {
    await this.prepareAndQueue({ kind: "run", select: selection(params) });
  }

  async buildModel(params: RunModelParams) {
    await this.prepareAndQueue({ kind: "build", select: selection(params) });
  }

  async buildProject() {
    await this.prepareAndQueue({ kind: "build" });
  }

  async runTest(testName: string) {
    await this.prepareAndQueue({ kind: "test", select: testName });
  }

  async runModelTest(modelName: string) {
    await this.prepareAndQueue({ kind: "test", select: modelName });
  }

  async compileModel(params: RunModelParams) {
    await this.prepareAndQueue({ kind: "compile", select: selection(params) });
  }

  clean() {
    return this.withRunResults(() => this.dbtProjectIntegration.clean());
  }

  debug() {
    return this.dbtProjectIntegration.debug();
  }

  async installDeps() {
    return this.withRunResults(() => this.dbtProjectIntegration.installDeps());
  }

  private withRunResults<T>(run: () => Promise<T>): Promise<T> {
    return withRunResults(this.runResultsReader, this.runHistory, run);
  }

  async compileQuery(query: string): Promise<string | undefined> {
    try {
      return await this.dbtProjectIntegration.unsafeCompileQuery(query);
    } catch (exc) {
      window.showErrorMessage(
        "Could not compile query: " +
          (exc instanceof Error ? exc.message : String(exc)),
      );
      return undefined;
    }
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

  async unsafeCompileQuery(query: string) {
    return this.dbtProjectIntegration.unsafeCompileQuery(query);
  }

  async getColumnsOfModel(modelName: string) {
    return this.dbtProjectIntegration.getColumnsOfModel(modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.dbtProjectIntegration.getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    this.terminal.debug(
      "getColumnValues",
      "finding distinct values for column",
      true,
      { model, column },
    );
    return this.dbtProjectIntegration.getColumnValues(model, column);
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
    } catch (exc) {
      window.showErrorMessage(
        "Could not generate schema yaml: " +
          (exc instanceof Error ? exc.message : String(exc)),
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
          const prefix = readSetting("generateModel.prefix");

          // Map setting to fileName
          const fileNameTemplateMap: FileNameTemplateMap = {
            "{prefix}_{sourceName}_{tableName}": `${prefix}_${sourceName}_${tableName}`,
            "{prefix}_{sourceName}__{tableName}": `${prefix}_${sourceName}__${tableName}`,
            "{prefix}_{tableName}": `${prefix}_${tableName}`,
            "{tableName}": `${tableName}`,
          };

          // Default filename template
          let fileName = `${prefix}_${sourceName}_${tableName}`;

          const fileNameTemplate = readSetting(
            "generateModel.fileNameTemplate",
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
        } catch (exc) {
          window.showErrorMessage(
            "An error occured while trying to generate the model: " +
              (exc instanceof Error ? exc.message : String(exc)) +
              ".",
          );
        }
      },
    );
  }

  async executeSQLOnQueryPanel(query: string, modelName: string) {
    const limit = readSetting("query.limit");
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

  throwDiagnosticsErrorIfAvailable() {
    const integrationDiagnostics = this.dbtProjectIntegration.getDiagnostics();
    const allIntegrationDiagnostics = [
      ...integrationDiagnostics.rebuildManifestDiagnostics,
    ];

    for (const diagnostic of allIntegrationDiagnostics) {
      if (diagnostic.severity === "error") {
        throw new Error(diagnostic.message);
      }
    }

    // Check VSCode diagnostic collections
    const vscodeCollections: DiagnosticCollection[] = [
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

  /** This project's defer settings, read from the same snapshot commands are built from. */
  getDeferConfig(): ResolvedDefer | undefined {
    return readProjectSnapshot(this.projectRoot).invocation.defer;
  }

  private async prepareAndQueue(cli: QueuedCliCommand): Promise<void> {
    try {
      this.addCommandToQueue(this.fusionCli().prepare(cli));
    } catch (error) {
      const statusMessage = formatCliStatus(
        cli,
        commandParamsFor(readProjectSnapshot(this.projectRoot), cli),
      );
      this.runHistoryService.notifyCommandFailed(statusMessage, String(error));
      this.terminal.error(
        "commandPreparationError",
        `Unable to prepare ${statusMessage}`,
        error,
      );
    }
  }

  private addCommandToQueue(command: DBTCommand): void {
    this.commandQueue.enqueue(
      async (signal) => {
        const result = await this.withRunResults(() => command.execute(signal));
        // dbt CLI resolves normally even on failure (CommandProcessExecution.complete()
        // never rejects for non-zero exit). Detect pre-execution failures (compilation
        // errors, config errors) by checking stdout.
        if (result?.stdout?.includes("Encountered an error:")) {
          throw new Error(result.stdout.trim());
        }
      },
      {
        statusMessage: formatCommandStatus(command),
        focus: command.focus,
        showProgress: command.showProgress,
      },
    );
  }

  private fusionCli(): FusionCli {
    return this.dbtProjectIntegration.getFusionCli();
  }

  getPublicationEpoch(): number {
    return this._manifestCacheEvent?.publicationEpoch ?? 0;
  }
}
