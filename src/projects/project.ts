import {
  Diagnostic,
  Disposable,
  Event,
  EventEmitter,
  Uri,
  window,
} from "vscode";
import {
  dbtProjectFilePath,
  readDbtProjectFile,
  ResolvedDefer,
} from "../core/project";
import { DBTProjectLog } from "../dbt_client/dbtProjectLog";
import { ProjectConfigChangedEvent } from "../dbt_client/event/projectConfigChangedEvent";
import { RunResultsEvent } from "../dbt_client/event/runResultsEvent";
import {
  DBColumn,
  DBTTerminal,
  type ManifestProject,
  ParsedManifest,
  QueryExecution,
  QueryExecutionResult,
  RunModelParams,
} from "../dbt_integration";
import {
  ExecutableLifecycle,
  FusionCommandIntegrationFactory,
} from "../fusion/executableLifecycle";
import { FusionCli } from "../fusion/fusionCli";
import { FusionExecutableResolver } from "../fusion/fusionExecutable";
import { FusionVersion } from "../fusion/fusionVersion";
import {
  hasProjectStrictAnalysis,
  resolveSchemaOrigin,
  SchemaOriginStatus,
} from "../fusion/schemaOrigin";
import { ModelNode } from "../local/lineageTypes";
import { RunHistoryService } from "../services/runHistoryService";
import { SharedStateService } from "../services/sharedStateService";
import { readSetting } from "../settings";
import { CommandQueue } from "./commandQueue";
import {
  ManifestParsers,
  ManifestTrigger,
  nextManifestPublication,
} from "./manifest";
import { ManifestRebuild } from "./manifestRebuild";
import type { Manifest } from "./manifestTypes";
import {
  findModelInTargetfolder,
  generateModel,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "./projectCodegen";
import {
  ProjectCommandDeps,
  queueCli,
  queueSelected,
  refreshCliConfig,
} from "./projectCommands";
import { ProjectDiagnostics } from "./projectDiagnostics";
import {
  isWithinRoot,
  packageNameOf,
  projectNameAt,
  sourcePathsOf,
} from "./projectPaths";
import {
  compileOrReport,
  executeWithLimit,
  getColumnValues,
  queryPanelPayload,
  SqlDeps,
} from "./projectSql";
import { readProjectSnapshot } from "./readProjectSnapshot";
import {
  RunResultsHistory,
  RunResultsReader,
  withRunResults,
} from "./runResults";

const LOG_SOURCE = "Project";

/** The collaborators a `Project` is built from. */
export interface ProjectOptions {
  dbtProjectLogFactory: (
    onProjectConfigChanged: Event<ProjectConfigChangedEvent>,
  ) => DBTProjectLog;
  terminal: DBTTerminal;
  sharedState: SharedStateService;
  runHistoryService: RunHistoryService;
  resolver: FusionExecutableResolver;
  cliFactory: FusionCommandIntegrationFactory;
  parsers: ManifestParsers;
  projectRoot: Uri;
}

/** One Declared Project: its Fusion executable, manifest publication, diagnostics, and dbt commands. */
export class Project implements Disposable, ManifestProject {
  private _manifest?: Manifest;
  readonly projectRoot: Uri;
  private readonly terminal: DBTTerminal;
  private readonly sharedState: SharedStateService;
  private readonly runHistoryService: RunHistoryService;
  private readonly lifecycle: ExecutableLifecycle;
  private readonly manifestRebuild: ManifestRebuild;
  private readonly trigger: ManifestTrigger;
  private readonly diagnostics: ProjectDiagnostics;
  private readonly dbtProjectLog: DBTProjectLog;
  private disposed = false;

  private _onProjectConfigChanged =
    new EventEmitter<ProjectConfigChangedEvent>();
  public onProjectConfigChanged = this._onProjectConfigChanged.event;
  private _onRunResults = new EventEmitter<RunResultsEvent>();
  public onRunResults = this._onRunResults.event;
  private _onSourceFileChanged = new EventEmitter<void>();
  public onSourceFileChanged = this._onSourceFileChanged.event;
  private _onDidChangeManifest = new EventEmitter<Project>();
  /** Fires after this project publishes a new manifest. */
  readonly onDidChangeManifest = this._onDidChangeManifest.event;
  private disposables: Disposable[] = [
    this._onDidChangeManifest,
    this._onProjectConfigChanged,
    this._onSourceFileChanged,
    this._onRunResults,
  ];

  /** The latest complete metadata publication. */
  get manifest(): Manifest | undefined {
    return this._manifest;
  }

  private readonly commandQueue = new CommandQueue();
  private readonly commandDeps: ProjectCommandDeps;
  private readonly runResultsReader: RunResultsReader;
  private readonly runHistory: RunResultsHistory = {
    addEntry: (entry) => {
      this.runHistoryService.addEntry(entry);
      const uniqueIds = entry.results.map((r) => r.uniqueId);
      this._onRunResults.fire(new RunResultsEvent(this, uniqueIds));
    },
  };

  constructor(options: ProjectOptions) {
    this.projectRoot = options.projectRoot;
    this.terminal = options.terminal;
    this.sharedState = options.sharedState;
    this.runHistoryService = options.runHistoryService;
    const root = this.projectRoot.fsPath;
    this.diagnostics = new ProjectDiagnostics(
      Uri.file(this.getDBTProjectFilePath()),
    );
    this.commandDeps = {
      commandQueue: this.commandQueue,
      cli: () => this.getFusionCli(),
      snapshot: () => readProjectSnapshot(this.projectRoot),
      withRunResults: (run) => this.withRunResults(run),
      notifyFailed: (statusMessage, error) =>
        this.runHistoryService.notifyCommandFailed(statusMessage, error),
      terminal: this.terminal,
    };
    this.runResultsReader = new RunResultsReader(
      () => this.getTargetPath(),
      () => this.getProjectName(),
      this.terminal,
    );
    this.trigger = new ManifestTrigger(root, this.terminal, {
      sourcePaths: () => sourcePathsOf(this),
      onProjectFileChanged: () => this.handleProjectFileChanged(),
      onSourceFileChanged: () => this.handleSourceFileChanged(),
    });
    this.lifecycle = new ExecutableLifecycle(
      options.resolver,
      options.cliFactory,
      root,
      this.terminal,
      {
        activate: (candidate, generation) =>
          this.manifestRebuild.prepareCandidate(candidate, generation),
        deactivate: () => this.trigger.stop(),
      },
    );
    this.manifestRebuild = new ManifestRebuild(
      this.lifecycle,
      options.parsers,
      this,
      this.terminal,
      {
        refreshConfig: (candidate) => this.refreshConfigWith(candidate, false),
        onStatus: (inProgress) => this.onRebuildStatus(inProgress),
        onParsed: (parsed) => this.publishParsedManifest(parsed),
      },
    );
    this.subscribeLifecycle();
    this.dbtProjectLog = options.dbtProjectLogFactory(
      this.onProjectConfigChanged,
    );
    this.disposables.push(
      this.diagnostics,
      this.commandQueue,
      this.commandQueue.onFailed(({ statusMessage, error }) =>
        this.commandDeps.notifyFailed(statusMessage, String(error)),
      ),
    );
    this.terminal.debug(
      LOG_SOURCE,
      `Created fusion dbt project ${this.getProjectName()} at ${this.projectRoot}`,
    );
  }

  private subscribeLifecycle(): void {
    this.lifecycle.onDidCommit(() => {
      this._onProjectConfigChanged.fire(new ProjectConfigChangedEvent(this));
      this.trigger.start();
    });
    this.lifecycle.onDidFailResolution((diagnostic) => {
      this.diagnostics.replaceExecutable(diagnostic);
      this.updateDiagnosticsInProblemsPanel();
    });
  }

  private get currentIntegration(): FusionCli | undefined {
    if (this.disposed) {
      return undefined;
    }
    return this.manifestRebuild.candidate() ?? this.lifecycle.current();
  }

  /** The CLI of the committed executable; throws until one is committed. */
  getFusionCli(): FusionCli {
    const integration = this.currentIntegration;
    if (!integration) {
      throw new Error(
        `Fusion CLI integration is not initialized for ${this.projectRoot.fsPath}`,
      );
    }
    return integration;
  }

  getProjectName(): string {
    return (
      this.currentIntegration?.getProjectName() ??
      projectNameAt(this.projectRoot.fsPath)
    );
  }

  getProjectRoot() {
    return this.projectRoot.fsPath;
  }

  getDBTProjectFilePath() {
    return dbtProjectFilePath(this.projectRoot.fsPath);
  }

  /** Version of the committed Fusion executable; undefined until one is committed. */
  getFusionVersion(): FusionVersion | undefined {
    return this.currentIntegration ? this.lifecycle.version : undefined;
  }

  /** Whether strict analysis of this project can run without the warehouse; see `resolveSchemaOrigin`. */
  schemaOriginStatus(
    fusionVersion = this.getFusionVersion(),
  ): SchemaOriginStatus {
    return resolveSchemaOrigin({
      projectConfig: readDbtProjectFile(this.projectRoot.fsPath).config,
      fusionVersion,
      sources: this._manifest?.sourceMetaMap ?? new Map(),
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

  getTargetPath(): string | undefined {
    return this.currentIntegration?.getTargetPath();
  }

  getPackageInstallPath(): string | undefined {
    return this.currentIntegration?.getPackageInstallPath();
  }

  getModelPaths(): string[] | undefined {
    return this.currentIntegration?.getModelPaths();
  }

  getSeedPaths(): string[] | undefined {
    return this.currentIntegration?.getSeedPaths();
  }

  getMacroPaths(): string[] | undefined {
    return this.currentIntegration?.getMacroPaths();
  }

  getAllDiagnostic(): Diagnostic[] {
    return this.diagnostics.all();
  }

  /** Republishes the rebuild diagnostics the active CLI reports. */
  updateDiagnosticsInProblemsPanel(): void {
    this.diagnostics.setKind(
      "rebuild-manifest",
      this.currentIntegration?.getDiagnostics().rebuildManifestDiagnostics ??
        [],
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.lifecycle.initialize();
    } catch (error) {
      const message = `initializing the dbt project at ${this.projectRoot}: ${error}.`;
      void window.showErrorMessage(
        `An unexpected error occured while ${message}`,
      );
    }
    this.disposables.push(this.dbtProjectLog);
    this.terminal.debug(
      LOG_SOURCE,
      `Initialized dbt project ${this.getProjectName()} at ${this.projectRoot}`,
    );
  }

  /** Starts a manifest rebuild without waiting for it. */
  async rebuildManifest(): Promise<void> {
    void this.rebuild();
  }

  /** Starts a project config refresh without waiting for it. */
  async refreshProjectConfig(): Promise<void> {
    void this.refreshConfigWith(this.getFusionCli(), true);
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    return this.manifestRebuild.parse(this.getFusionCli());
  }

  private async rebuild(): Promise<void> {
    this.terminal.debug(
      LOG_SOURCE,
      `Going to rebuild the manifest for project at ${this.projectRoot.fsPath}`,
    );
    await this.manifestRebuild.rebuild(this.getFusionCli());
  }

  private async refreshConfigWith(
    delegate: FusionCli,
    reportPaths: boolean,
  ): Promise<void> {
    const label = `"${this.getProjectName()}" at ${this.projectRoot.fsPath}`;
    const sourcePaths = reportPaths ? () => sourcePathsOf(this) : undefined;
    if (await refreshCliConfig(delegate, this.terminal, label, sourcePaths)) {
      this.diagnostics.clearConfig();
      this.updateDiagnosticsInProblemsPanel();
    }
  }

  private async handleProjectFileChanged(): Promise<void> {
    await this.refreshConfigWith(this.getFusionCli(), true);
    this._onProjectConfigChanged.fire(new ProjectConfigChangedEvent(this));
    await this.rebuild();
  }

  private async handleSourceFileChanged(): Promise<void> {
    this._onSourceFileChanged.fire();
    await this.rebuild();
  }

  private onRebuildStatus(inProgress: boolean): void {
    if (this.disposed) {
      return;
    }
    if (!inProgress) {
      this.updateDiagnosticsInProblemsPanel();
    }
  }

  private publishParsedManifest(parsed: ParsedManifest): void {
    if (this.disposed) {
      return;
    }
    this._manifest = nextManifestPublication(this, parsed);
    this._onDidChangeManifest.fire(this);
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
  }

  /** The last `metadata.adapter_type` a manifest carried; `"unknown"` until one has. */
  getAdapterType() {
    return this.manifestRebuild.adapterType || "unknown";
  }

  findPackageName(uri: Uri): string | undefined {
    return packageNameOf(
      this.projectRoot.toString(),
      this.getPackageInstallPath(),
      uri,
    );
  }

  contains(uri: Uri) {
    return isWithinRoot(this.projectRoot.fsPath, uri.fsPath);
  }

  async runModel(params: RunModelParams) {
    await queueSelected(this.commandDeps, "run", params);
  }

  async buildModel(params: RunModelParams) {
    await queueSelected(this.commandDeps, "build", params);
  }

  async buildProject() {
    await queueCli(this.commandDeps, { kind: "build" });
  }

  async runTest(testName: string) {
    await queueCli(this.commandDeps, { kind: "test", select: testName });
  }

  async runModelTest(modelName: string) {
    await queueCli(this.commandDeps, { kind: "test", select: modelName });
  }

  async compileModel(params: RunModelParams) {
    await queueSelected(this.commandDeps, "compile", params);
  }

  clean() {
    return this.withRunResults(() =>
      this.getFusionCli().run({ kind: "clean" }),
    );
  }

  debug() {
    return this.getFusionCli().run({ kind: "debug" });
  }

  async installDeps() {
    return this.withRunResults(() => this.getFusionCli().run({ kind: "deps" }));
  }

  private withRunResults<T>(run: () => Promise<T>): Promise<T> {
    return withRunResults(this.runResultsReader, this.runHistory, run);
  }

  async compileQuery(query: string): Promise<string | undefined> {
    return compileOrReport((q) => this.unsafeCompileQuery(q), query);
  }

  showRunSQL(modelPath: Uri) {
    const root = this.projectRoot.fsPath;
    void findModelInTargetfolder(root, this.getTargetPath(), modelPath, "run");
  }

  async unsafeCompileQuery(query: string) {
    return this.getFusionCli().compileInline(query);
  }

  async getColumnsOfModel(modelName: string) {
    return this.getFusionCli().getColumnsOfModel(modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.getFusionCli().getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    return getColumnValues(this.getFusionCli(), this.terminal, model, column);
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
    const payload = queryPanelPayload(this.sqlDeps, query, modelName, limit);
    if (payload) {
      this.sharedState.fire({ command: "executeQuery", payload });
    }
  }

  async immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    return executeWithLimit(this.sqlDeps, query, modelName, limit, true);
  }

  async executeSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecution> {
    return executeWithLimit(this.sqlDeps, query, modelName, limit, false);
  }

  private get sqlDeps(): SqlDeps {
    return { project: this, terminal: this.terminal };
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.trigger.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    await this.lifecycle.dispose();
  }

  mergeColumnsFromDB(
    node: Pick<ModelNode, "columns">,
    columnsFromDB: DBColumn[],
  ) {
    return mergeColumnsFromDB(this.getAdapterType(), node, columnsFromDB);
  }

  throwDiagnosticsErrorIfAvailable() {
    this.diagnostics.throwFirstError();
  }

  /** This project's defer settings, read from the same snapshot commands are built from. */
  getDeferConfig(): ResolvedDefer | undefined {
    return readProjectSnapshot(this.projectRoot).invocation.defer;
  }
}
