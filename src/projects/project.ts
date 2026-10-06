import { relative as relativePath, sep } from "path";
import {
  CustomExecution,
  Diagnostic,
  Disposable,
  Event,
  EventEmitter,
  Task,
  Uri,
  window,
} from "vscode";
import { QueryExecution } from "../core/dbtCommand";
import type { Log } from "../core/log";
import { dbColumnsFrom } from "../core/lsp";
import { type ManifestProject } from "../core/manifest";
import {
  dbtProjectFilePath,
  readDbtProjectFile,
  ResolvedDefer,
} from "../core/project";
import { CommandProcessResult, DBColumn } from "../core/types";
import {
  ParsedManifest,
  QueryExecutionResult,
  RunModelParams,
} from "../dbt_integration/domain";
import {
  ExecutableLifecycle,
  FusionCommandIntegrationFactory,
} from "../fusion/executableLifecycle";
import { FusionCli, QueuedCliCommand } from "../fusion/fusionCli";
import {
  createFusionCommands,
  type FusionCommands,
} from "../fusion/fusionCommands";
import { FusionExecutableResolver } from "../fusion/fusionExecutable";
import type { FusionClient } from "../fusion/fusionLanguageClient";
import { FusionVersion } from "../fusion/fusionVersion";
import { ModelNode } from "../local/lineageTypes";
import { readSetting } from "../settings";
import { CommandQueue } from "./commandQueue";
import { compiledModelSql } from "./compiledModel";
import {
  cliCommandOf,
  dbtTask,
  DbtTaskDefinition,
  DbtTaskTerminal,
  definitionOf,
  executeTask,
  taskName,
} from "./dbtTask";
import { graphUnavailable } from "./graphAvailability";
import {
  ManifestParsers,
  ManifestTrigger,
  nextManifestPublication,
} from "./manifest";
import { ManifestRebuild } from "./manifestRebuild";
import type { Manifest } from "./manifestTypes";
import type { ParseDemand } from "./parseDemand";
import {
  findModelInTargetfolder,
  generateModel,
  generateSchemaYML,
  mergeColumnsFromDB,
} from "./projectCodegen";
import {
  ProjectCommandDeps,
  queueCli,
  refreshCliConfig,
  selection,
} from "./projectCommands";
import { ProjectDiagnostics } from "./projectDiagnostics";
import { ProjectErrors } from "./projectErrors";
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
import { RunHistoryService } from "./runHistoryService";
import {
  RunResultsHistory,
  RunResultsReader,
  withRunResults,
} from "./runResults";
import {
  hasProjectStrictAnalysis,
  resolveSchemaOrigin,
  SchemaOriginStatus,
} from "./schemaOrigin";
import { SharedStateService } from "./sharedStateService";

const LOG_SOURCE = "Project";

/** The collaborators a `Project` is built from. */
export interface ProjectOptions {
  /** The Declared Project's log; the Project does not dispose it. */
  terminal: Log;
  sharedState: SharedStateService;
  runHistoryService: RunHistoryService;
  resolver: FusionExecutableResolver;
  cliFactory: FusionCommandIntegrationFactory;
  parsers: ManifestParsers;
  projectRoot: Uri;
  /** The number of Declared Projects, which decides whether task names carry the project name. */
  projectCount?: () => number;
  /** The project's current Fusion Client; resolved per call so a restart leaves no stale reference. */
  fusionClient?: () => FusionClient | undefined;
  /** Fires when that client is replaced or changes state. */
  clientChanged?: Event<void>;
  /** Views reading parse-owned fields; without it every source change rebuilds. */
  parseDemand?: ParseDemand;
}

/** One Declared Project: its Fusion executable, manifest publication, diagnostics, and dbt commands. */
export class Project implements Disposable, ManifestProject {
  private _manifest?: Manifest;
  /** Whether the published manifest was merged with a Server Producer value. */
  private serverValuePublished = false;
  readonly projectRoot: Uri;
  private readonly terminal: Log;
  private readonly sharedState: SharedStateService;
  private readonly runHistoryService: RunHistoryService;
  private readonly lifecycle: ExecutableLifecycle;
  private readonly manifestRebuild: ManifestRebuild;
  private readonly trigger: ManifestTrigger;
  private readonly diagnostics: ProjectDiagnostics;
  /** This project's configuration failures, as notified and logged. */
  readonly errors: ProjectErrors;
  private readonly projectCount: () => number;
  /** Server commands over the project's current Fusion Client. */
  readonly lsp: FusionCommands;
  private readonly fusionClient: () => FusionClient | undefined;
  private readonly parseDemand: ParseDemand | undefined;
  /** A source file changed since the last parse and no consumer was showing to need it. */
  private parseStale = false;
  /** Counts source-file changes; a parse records the count it started at. */
  private sourceGeneration = 0;
  private parseStartedAtGeneration = 0;
  private rebuilding: Promise<void> | undefined;
  private rebuildAgain = false;
  private warnedTasksUnavailable = false;
  private disposed = false;

  private _onSourceFileChanged = new EventEmitter<void>();
  /** Fires after the debounce for a model, macro, seed or `dbt_project.yml` change on disk. */
  public onSourceFileChanged = this._onSourceFileChanged.event;
  /** Fires when the project's Fusion client is replaced or changes state. */
  readonly onDidChangeClient: Event<void>;
  private _onDidParse = new EventEmitter<ParsedManifest>();
  /**
   * Fires with each `dbt parse` result. Producer input only: it is not a manifest publication, so it carries no
   * server graph and no epoch. Consumers read `Projects.onDidChangeManifest`.
   */
  readonly onDidParse = this._onDidParse.event;
  private _onDidCompile = new EventEmitter<void>();
  /** Fires when the project's language server reports a finished compile. */
  readonly onDidCompile = this._onDidCompile.event;
  private disposables: Disposable[] = [
    this._onDidParse,
    this._onSourceFileChanged,
    this._onDidCompile,
  ];

  /** Why the server-owned graph is empty (the client is not running, or has not compiled yet), or `undefined`. */
  graphNotice(): string | undefined {
    const client = this.fusionClient();
    return graphUnavailable(
      client?.state ?? "notRunning",
      this.serverValuePublished,
    );
  }

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
    },
  };

  constructor(options: ProjectOptions) {
    this.projectRoot = options.projectRoot;
    this.terminal = options.terminal;
    this.sharedState = options.sharedState;
    this.runHistoryService = options.runHistoryService;
    this.projectCount = options.projectCount ?? (() => 1);
    this.fusionClient = options.fusionClient ?? (() => undefined);
    this.parseDemand = options.parseDemand;
    this.lsp = createFusionCommands(this.fusionClient);
    this.onDidChangeClient = options.clientChanged ?? (() => Disposable.from());
    const root = this.projectRoot.fsPath;
    this.diagnostics = new ProjectDiagnostics(
      Uri.file(this.getDBTProjectFilePath()),
    );
    this.errors = new ProjectErrors(
      this.projectRoot,
      () => this.getProjectName(),
      () => readProjectSnapshot(this.projectRoot),
      this.terminal,
    );
    this.commandDeps = {
      commandQueue: this.commandQueue,
      cli: () => this.getFusionCli(),
      snapshot: () => readProjectSnapshot(this.projectRoot),
      withRunResults: (run, launched) => this.withRunResults(run, launched),
      notifyFailed: (statusMessage, error) =>
        this.runHistoryService.notifyCommandFailed(statusMessage, error),
      onCommandOutput: (result) => this.errors.reportCommand(result),
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
    this.disposables.push(
      this.diagnostics,
      this.errors,
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

  /** The Declared Project's log, for features that act on this Project. */
  get log(): Log {
    return this.terminal;
  }

  private subscribeLifecycle(): void {
    if (this.parseDemand) {
      this.disposables.push(
        this.parseDemand.onDidBecomeActive(() => {
          if (this.parseStale) {
            void this.rebuild();
          }
        }),
      );
    }
    this.lifecycle.onDidCommit(() => {
      this.updateDiagnosticsInProblemsPanel();
      this.trigger.start();
    });
    this.lifecycle.onDidFailResolution((diagnostic) => {
      this.diagnostics.replaceExecutable(diagnostic);
      this.errors.report("executable", diagnostic ? [diagnostic.message] : []);
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
  schemaOriginStatus(): SchemaOriginStatus {
    return resolveSchemaOrigin({
      projectConfig: readDbtProjectFile(this.projectRoot.fsPath).config,
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

  /** Republishes the rebuild diagnostics the active CLI reports, and reports its configuration errors. */
  updateDiagnosticsInProblemsPanel(): void {
    const rebuild =
      this.currentIntegration?.getDiagnostics().rebuildManifestDiagnostics ??
      [];
    this.diagnostics.setKind("rebuild-manifest", rebuild);
    this.errors.reportParse(rebuild);
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
    this.parseStartedAtGeneration = this.sourceGeneration;
    return this.manifestRebuild.parse(this.getFusionCli());
  }

  private async rebuild(): Promise<void> {
    if (this.rebuilding) {
      this.rebuildAgain = true;
      return this.rebuilding;
    }
    this.rebuilding = this.rebuildLoop().finally(() => {
      this.rebuilding = undefined;
    });
    return this.rebuilding;
  }

  /** Runs one parse at a time, and one more for every request made while a parse ran. */
  private async rebuildLoop(): Promise<void> {
    do {
      this.rebuildAgain = false;
      this.parseStartedAtGeneration = this.sourceGeneration;
      this.terminal.debug(
        LOG_SOURCE,
        `Going to rebuild the manifest for project at ${this.projectRoot.fsPath}`,
      );
      await this.manifestRebuild.rebuild(this.getFusionCli());
    } while (this.rebuildAgain && !this.disposed);
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
    this.sourceGeneration += 1;
    this._onSourceFileChanged.fire();
    await this.refreshConfigWith(this.getFusionCli(), true);
    await this.rebuild();
  }

  private async handleSourceFileChanged(): Promise<void> {
    this.sourceGeneration += 1;
    this._onSourceFileChanged.fire();
    if (this.parseDemand && !this.parseDemand.active) {
      this.parseStale = true;
      return;
    }
    await this.rebuild();
  }

  /** Rebuilds a stale parse; resolves once the manifest is current. */
  async ensureParsed(): Promise<void> {
    if (this.parseStale && !this.disposed) {
      await this.rebuild();
    }
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
    // A parse that read the files before the latest source change does not make the parse current.
    if (this.parseStartedAtGeneration === this.sourceGeneration) {
      this.parseStale = false;
    }
    this._onDidParse.fire(parsed);
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
  }

  /** Called by the Fusion client pool for every compile the server finishes. */
  notifyCompileComplete(): void {
    if (!this.disposed) {
      this._onDidCompile.fire();
    }
  }

  /** Replaces the published manifest with the composite producer's merged value, stamped as the next publication. */
  publishMerged(
    merged: ParsedManifest,
    hasServerValue: boolean,
  ): Manifest | undefined {
    if (this.disposed) {
      return undefined;
    }
    this.serverValuePublished = hasServerValue;
    this._manifest = nextManifestPublication(this, merged);
    return this._manifest;
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
    await this.startTask({ kind: "run", select: selection(params) });
  }

  async buildModel(params: RunModelParams) {
    await this.startTask({ kind: "build", select: selection(params) });
  }

  async buildProject() {
    await this.startTask({ kind: "build" });
  }

  async runTest(testName: string) {
    await this.startTask({ kind: "test", select: testName });
  }

  async runModelTest(modelName: string) {
    await this.startTask({ kind: "test", select: modelName });
  }

  async compileModel(params: RunModelParams) {
    await this.startTask({ kind: "compile", select: selection(params) });
  }

  clean() {
    return this.withRunResults(() =>
      this.getFusionCli().run({ kind: "clean" }),
    );
  }

  debug() {
    return this.getFusionCli().run({ kind: "debug" });
  }

  /** Runs `dbt deps` as a task; rejects when it fails or exits non-zero. */
  async installDeps() {
    const { started, ended } = await this.startTask({ kind: "deps" });
    const run = await Promise.race([started, ended.then(() => undefined)]);
    const result = await run?.();
    if (result && result.exitCode !== undefined && result.exitCode !== 0) {
      throw new Error(`dbt deps exited with code ${result.exitCode}`);
    }
  }

  /**
   * Executes the dbt task for `cli` outside the command queue, after any active task with the same definition ends.
   * `started` resolves with its queued run once its terminal opens; `ended` resolves when its execution ends. When
   * VS Code cannot execute tasks, the command is queued without a terminal and `ended` resolves once it has run.
   */
  private async startTask(cli: QueuedCliCommand): Promise<{
    started: Promise<() => Promise<CommandProcessResult | undefined>>;
    ended: Promise<void>;
  }> {
    const root = this.projectRoot.fsPath;
    const definition = definitionOf(cli, root);
    let onStart!: (run: Promise<CommandProcessResult | undefined>) => void;
    const started = new Promise<
      () => Promise<CommandProcessResult | undefined>
    >((resolve) => (onStart = (run) => resolve(() => run)));
    const task = dbtTask(
      definition,
      root,
      this.taskName(cli),
      this.taskExecution(onStart),
    );
    try {
      const { ended } = await executeTask(task);
      return { started, ended };
    } catch (error) {
      this.warnTasksUnavailable(error);
      const run = this.runTask(
        definition,
        new DbtTaskTerminal(() => undefined),
      );
      return {
        started: Promise.resolve(() => run),
        ended: run.then(
          () => undefined,
          () => undefined,
        ),
      };
    }
  }

  /** The name of the task that runs `cli` in this project. */
  taskName(cli: QueuedCliCommand): string {
    return taskName(cli, this.getProjectName(), this.projectCount());
  }

  private warnTasksUnavailable(error: unknown): void {
    if (this.warnedTasksUnavailable) {
      return;
    }
    this.warnedTasksUnavailable = true;
    this.terminal.warn(
      LOG_SOURCE,
      `Running dbt commands without a task terminal: VS Code could not execute the dbt task: ${error}`,
    );
  }

  /** A task named `name` that runs `definition` in this project. */
  task(definition: DbtTaskDefinition, name: string): Task {
    return dbtTask(
      definition,
      this.projectRoot.fsPath,
      name,
      this.taskExecution(),
    );
  }

  /**
   * Queues the command `definition` names to run in `terminal`, settling with that run; an unknown command closes
   * it as failed.
   */
  async runTask(
    definition: DbtTaskDefinition,
    terminal: DbtTaskTerminal,
  ): Promise<CommandProcessResult | undefined> {
    const cli = cliCommandOf(definition);
    if (!cli) {
      terminal.fail(`Unknown dbt task command: ${definition.command}`);
      return undefined;
    }
    return queueCli(this.commandDeps, cli, terminal);
  }

  /**
   * Every terminal it creates, including one for each Rerun, queues its task definition through `runTask` and passes
   * the run to `onStart`.
   */
  private taskExecution(
    onStart?: (run: Promise<CommandProcessResult | undefined>) => void,
  ): CustomExecution {
    return new CustomExecution(
      async (definition) =>
        new DbtTaskTerminal((terminal) => {
          const run = this.runTask(definition as DbtTaskDefinition, terminal);
          run.catch(() => undefined);
          onStart?.(run);
        }),
    );
  }

  private withRunResults<T>(
    run: () => Promise<T>,
    launched?: readonly string[],
  ): Promise<T> {
    return withRunResults(
      this.runResultsReader,
      this.runHistory,
      run,
      launched,
    );
  }

  /** Compiles a saved model through the language server, and unsaved or untitled text through the CLI. */
  async compileQuery(query: string, model?: Uri): Promise<string | undefined> {
    return compileOrReport(
      async (q) =>
        model && model.scheme !== "untitled"
          ? ((await this.compiledSql(model)) ?? this.unsafeCompileQuery(q))
          : this.unsafeCompileQuery(q),
      query,
    );
  }

  showRunSQL(modelPath: Uri) {
    const root = this.projectRoot.fsPath;
    void findModelInTargetfolder(root, this.getTargetPath(), modelPath, "run");
  }

  /** The compiled SQL of a saved model from the language server; `undefined` before its first compile. */
  async compiledSql(model: Uri): Promise<string | undefined> {
    return compiledModelSql(this.lsp, model);
  }

  /** Compiles text that has no file, through the CLI. */
  async unsafeCompileQuery(query: string) {
    return this.getFusionCli().compileInline(query);
  }

  /**
   * A model's columns: from the language server when it knows them, else from the warehouse through the CLI (always
   * in `baseline`, where the server returns none).
   */
  async getColumnsOfModel(modelName: string): Promise<DBColumn[]> {
    const path = this.manifest?.nodeMetaMap.lookupByBaseName(modelName)?.path;
    if (path) {
      const relative = relativePath(this.projectRoot.fsPath, path)
        .split(sep)
        .join("/");
      try {
        const columns = dbColumnsFrom(await this.lsp.getCurrentNode(relative));
        if (columns) {
          return columns;
        }
      } catch (error) {
        this.terminal.debug("Project", "getCurrentNode failed", error);
      }
    }
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
