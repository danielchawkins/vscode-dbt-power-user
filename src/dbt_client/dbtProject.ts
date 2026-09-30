import { inject } from "inversify";
import * as path from "path";
import {
  Diagnostic,
  Disposable,
  Event,
  EventEmitter,
  Uri,
  window,
} from "vscode";
import { commandParamsFor } from "../core/cli";
import {
  dbtProjectFilePath,
  readDbtProjectFile,
  ResolvedDefer,
} from "../core/project";
import {
  DBColumn,
  DBTCommand,
  DBTDiagnosticData,
  DBTTerminal,
  ParsedManifest,
  QueryExecutionResult,
  RunModelParams,
} from "../dbt_integration";
import { EXECUTABLE_DIAGNOSTIC_SOURCE } from "../fusion/executableLifecycle";
import { FusionCli, QueuedCliCommand } from "../fusion/fusionCli";
import {
  hasProjectStrictAnalysis,
  resolveSchemaOrigin,
  SchemaOriginStatus,
} from "../fusion/schemaOrigin";
import { ModelNode } from "../local/lineageTypes";
import { CommandQueue, formatCommandStatus } from "../projects/commandQueue";
import {
  createYMLContent,
  findModelInTargetfolder,
  generateModel,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "../projects/projectCodegen";
import { ProjectDiagnostics } from "../projects/projectDiagnostics";
import { readProjectSnapshot } from "../projects/readProjectSnapshot";
import {
  RunResultsHistory,
  RunResultsReader,
  withRunResults,
} from "../projects/runResults";
import { RunHistoryService } from "../services/runHistoryService";
import { SharedStateService } from "../services/sharedStateService";
import { readSetting } from "../settings";
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
  private readonly diagnostics: ProjectDiagnostics;
  private disposables: Disposable[] = [
    this._onProjectConfigChanged,
    this._onSourceFileChanged,
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
    this.diagnostics = new ProjectDiagnostics(
      Uri.file(this.getDBTProjectFilePath()),
    );
    this.disposables.push(
      this.diagnostics,
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
        if (!status.inProgress) {
          this.updateRebuildManifestDiagnostics();
        }
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
    return this.diagnostics.all();
  }

  private updateRebuildManifestDiagnostics(): void {
    this.diagnostics.setKind(
      "rebuild-manifest",
      this.dbtProjectIntegration.getDiagnostics().rebuildManifestDiagnostics,
    );
  }

  updateDiagnosticsInProblemsPanel(): void {
    const { projectConfigDiagnostics } =
      this.dbtProjectIntegration.getDiagnostics();
    const isExecutable = (data: DBTDiagnosticData) =>
      data.source === EXECUTABLE_DIAGNOSTIC_SOURCE;
    this.updateRebuildManifestDiagnostics();
    this.diagnostics.setKind(
      "project-config",
      projectConfigDiagnostics.filter((data) => !isExecutable(data)),
    );
    this.diagnostics.setKind(
      "fusion-executable",
      projectConfigDiagnostics.filter(isExecutable),
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
    return createYMLContent(columnsInRelation, modelName);
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
    return generateSchemaYML(this, modelPath, modelName);
  }

  async generateModel(
    sourceName: string,
    tableName: string,
    sourcePath: string,
  ) {
    return generateModel(
      this,
      this.terminal,
      sourceName,
      tableName,
      sourcePath,
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
    const root = this.projectRoot.fsPath;
    return findModelInTargetfolder(root, this.getTargetPath(), modelPath, type);
  }

  mergeColumnsFromDB(
    node: Pick<ModelNode, "columns">,
    columnsFromDB: DBColumn[],
  ) {
    return mergeColumnsFromDB(this.getAdapterType(), node, columnsFromDB);
  }

  throwDiagnosticsErrorIfAvailable() {
    const error = this.diagnostics.firstError();
    if (error) {
      throw new Error(error.message);
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
