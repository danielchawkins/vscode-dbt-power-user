import type { Diagnostic, Event } from "vscode";
import { Disposable, EventEmitter, Uri } from "vscode";
import type { ParsedManifest } from "../../core/dbt/domain";
import type { Log } from "../../core/log";
import { type ManifestProject } from "../../core/manifest/index";
import { isAtOrBelow } from "../../core/paths";
import type { ProjectPaths, ResolvedDefer } from "../../core/snapshot/index";
import { dbtProjectFilePath } from "../../core/snapshot/index";
import type { FusionCommandIntegrationFactory } from "../../fusion/executableLifecycle";
import { ExecutableLifecycle } from "../../fusion/executableLifecycle";
import type { FusionCli } from "../../fusion/fusionCli";
import type { FusionClient } from "../../fusion/fusionClient";
import {
  createFusionCommands,
  type FusionCommands,
} from "../../fusion/fusionCommands";
import type {
  FusionExecutableResolver,
  ResolverEnvironment,
} from "../../fusion/fusionExecutable";
import type { FusionVersion } from "../../fusion/fusionVersion";
import { followClientCompiles } from "../clients/clientChange";
import { readProjectSnapshot } from "../clients/readProjectSnapshot";
import type { ManifestParsers } from "../manifest/manifest";
import { ManifestRebuild } from "../manifest/manifestRebuild";
import { ManifestState } from "../manifest/manifestState";
import { ManifestTrigger } from "../manifest/manifestTrigger";
import type { Manifest } from "../manifest/manifestTypes";
import type { ParseDemand } from "../manifest/parseDemand";
import { ParseScheduler } from "../manifest/parseScheduler";
import type { RunResultsHistory } from "../manifest/runResults";
import { RunResultsReader, withRunResults } from "../manifest/runResults";
import { notifyError } from "../output/notifications";
import { ProjectDiagnostics } from "../output/projectDiagnostics";
import { ProjectErrors } from "../output/projectErrors";
import type { RunHistoryService } from "../output/runHistoryService";
import type { SchemaOriginStatus } from "../registry/schemaOrigin";
import { projectOptIns, projectSchemaOrigin } from "../registry/schemaOrigin";
import { CommandQueue } from "./commandQueue";
import type { ProjectCommandDeps } from "./projectCommands";
import { refreshCliConfig } from "./projectCommands";
import { ProjectDbtCommands } from "./projectDbtCommands";
import { ProjectQueries } from "./projectQueries";
import {
  packageNameOf,
  projectNameAt,
  sourcePathsOf,
} from "./projectRootPaths";
import { ProjectTasks } from "./projectTasks";
import type { SharedStateService } from "./sharedStateService";

const LOG_SOURCE = "Project";

/** The collaborators a `Project` is built from. */
export interface ProjectOptions {
  /** The Declared Project's log; the Project does not dispose it. */
  terminal: Log;
  sharedState: SharedStateService;
  runHistoryService: RunHistoryService;
  resolver: FusionExecutableResolver;
  cliFactory: FusionCommandIntegrationFactory;
  /** The project's resolved environment for executable lookup; the host's when absent. */
  environment?: () => Promise<ResolverEnvironment>;
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
  readonly projectRoot: Uri;
  private readonly terminal: Log;
  private readonly sharedState: SharedStateService;
  /** Compile, column and query operations. */
  readonly queries: ProjectQueries;
  /** dbt commands, each run as a task. */
  readonly commands: ProjectDbtCommands;
  private readonly runHistoryService: RunHistoryService;
  private readonly lifecycle: ExecutableLifecycle;
  private readonly manifestRebuild: ManifestRebuild;
  private readonly trigger: ManifestTrigger;
  private readonly scheduler: ParseScheduler;
  private readonly diagnostics: ProjectDiagnostics;
  /** This project's configuration failures, as notified and logged. */
  readonly errors: ProjectErrors;
  private readonly projectCount: () => number;
  /** Server commands over the project's current Fusion Client. */
  readonly lsp: FusionCommands;
  private readonly fusionClient: () => FusionClient | undefined;
  private disposed = false;

  private _onSourceFileChanged = new EventEmitter<void>();
  /** Fires after the debounce for a model, macro, seed or `dbt_project.yml` change on disk. */
  public onSourceFileChanged = this._onSourceFileChanged.event;
  /** Fires when the project's Fusion client is replaced or changes state. */
  readonly onDidChangeClient: Event<void>;
  private readonly published: ManifestState<Project>;
  /**
   * Fires with each `dbt parse` result. Producer input only: it is not a manifest publication, so it carries no
   * server graph and no epoch. Consumers read `Projects.onDidChangeManifest`.
   */
  readonly onDidParse: ManifestState<Project>["onDidParse"];
  /** Fires when the project's language server reports a finished compile. */
  readonly onDidCompile: ManifestState<Project>["onDidCompile"];
  private disposables: Disposable[] = [this._onSourceFileChanged];

  /** Why the server-owned graph is empty (the client is not running, or has not compiled yet), or `undefined`. */
  graphNotice(): string | undefined {
    return this.published.graphNotice();
  }

  /** The latest complete metadata publication. */
  get manifest(): Manifest | undefined {
    return this.published.manifest;
  }

  private readonly commandQueue = new CommandQueue();
  private readonly commandDeps: ProjectCommandDeps;
  private readonly tasks: ProjectTasks;
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
    this.lsp = createFusionCommands(this.fusionClient);
    this.onDidChangeClient = options.clientChanged ?? (() => Disposable.from());
    this.published = new ManifestState(this, this.fusionClient, {
      follow: (listener) =>
        followClientCompiles(
          this.fusionClient,
          this.onDidChangeClient,
          listener,
        ),
      reportErrors: (errors) => this.errors.reportCompile(errors),
    });
    this.onDidParse = this.published.onDidParse;
    this.onDidCompile = this.published.onDidCompile;
    this.disposables.push(this.published);
    const root = this.projectRoot.fsPath;
    this.diagnostics = new ProjectDiagnostics(
      Uri.file(this.getDBTProjectFilePath()),
    );
    this.errors = new ProjectErrors({
      root: this.projectRoot,
      projectName: () => this.getProjectName(),
      snapshot: () => readProjectSnapshot(this.projectRoot),
      terminal: this.terminal,
    });
    this.commandDeps = this.createCommandDeps();
    this.tasks = new ProjectTasks({
      root,
      projectName: () => this.getProjectName(),
      projectCount: this.projectCount,
      commandDeps: this.commandDeps,
      terminal: this.terminal,
    });
    this.queries = new ProjectQueries(this, this.terminal, this.sharedState);
    this.commands = new ProjectDbtCommands(this, this.tasks);
    this.runResultsReader = new RunResultsReader(
      () => this.paths()?.targetPath,
      () => this.getProjectName(),
      this.terminal,
    );
    this.scheduler = this.createScheduler(options.parseDemand);
    this.disposables.push(this.scheduler);
    this.trigger = new ManifestTrigger(root, this.terminal, {
      sourcePaths: () => sourcePathsOf(this.paths()),
      onProjectFileChanged: () => this.scheduler.projectFileChanged(),
      onSourceFileChanged: () => this.scheduler.sourceFileChanged(),
    });
    this.lifecycle = this.createLifecycle(options);
    this.manifestRebuild = new ManifestRebuild({
      lifecycle: this.lifecycle,
      parsers: options.parsers,
      project: this,
      terminal: this.terminal,
      callbacks: {
        refreshConfig: (candidate) => this.refreshConfigWith(candidate, false),
        onStatus: (inProgress) => this.onRebuildStatus(inProgress),
        onParsed: (parsed) => this.publishParsedManifest(parsed),
      },
    });
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
      `Created fusion dbt project ${this.getProjectName()} at ${this.projectRoot.toString()}`,
    );
  }

  private createLifecycle(options: ProjectOptions): ExecutableLifecycle {
    return new ExecutableLifecycle({
      resolver: options.resolver,
      factory: options.cliFactory,
      projectRoot: this.projectRoot.fsPath,
      terminal: this.terminal,
      hooks: {
        environment: options.environment,
        activate: (candidate, generation) =>
          this.manifestRebuild.prepareCandidate(candidate, generation),
        deactivate: () => this.trigger.stop(),
      },
    });
  }

  private createScheduler(demand: ParseDemand | undefined): ParseScheduler {
    return new ParseScheduler({
      log: this.terminal,
      root: this.projectRoot.fsPath,
      rebuildOnce: () => this.manifestRebuild.rebuild(this.getFusionCli()),
      refreshConfig: () => this.refreshConfigWith(this.getFusionCli(), true),
      onSourceChanged: () => this._onSourceFileChanged.fire(),
      isDisposed: () => this.disposed,
      demand,
    });
  }

  private createCommandDeps(): ProjectCommandDeps {
    return {
      commandQueue: this.commandQueue,
      cli: () => this.getFusionCli(),
      snapshot: () => readProjectSnapshot(this.projectRoot),
      withRunResults: (run, launched) => this.withRunResults(run, launched),
      notifyFailed: (statusMessage, error) =>
        this.runHistoryService.notifyCommandFailed(statusMessage, error),
      onCommandOutput: (result) => this.errors.reportCommand(result),
      terminal: this.terminal,
    };
  }

  /** The Declared Project's log, for features that act on this Project. */
  get log(): Log {
    return this.terminal;
  }

  private subscribeLifecycle(): void {
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
    return projectSchemaOrigin(this.projectRoot.fsPath, this.manifest);
  }

  /** The column-lineage opt-ins this project has made in its own project file; none when it is unreadable. */
  projectOptIns(): { strict: boolean; schemaOrigin: SchemaOriginStatus } {
    return projectOptIns(this.projectRoot.fsPath, this.manifest);
  }

  /** The resource paths of the attached Fusion CLI; undefined until one is attached. */
  paths(): ProjectPaths | undefined {
    return this.currentIntegration?.paths();
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
      void notifyError(
        this,
        `Unexpected error initializing the dbt project at ${this.projectRoot.fsPath}`,
        error,
      );
    }
    this.terminal.debug(
      LOG_SOURCE,
      `Initialized dbt project ${this.getProjectName()} at ${this.projectRoot.toString()}`,
    );
  }

  /** Starts a manifest rebuild without waiting for it. */
  async rebuildManifest(): Promise<void> {
    void this.scheduler.rebuild();
  }

  /** Starts a project config refresh without waiting for it. */
  async refreshProjectConfig(): Promise<void> {
    void this.refreshConfigWith(this.getFusionCli(), true);
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    this.scheduler.markParseStarted();
    return this.manifestRebuild.parse(this.getFusionCli());
  }

  private async refreshConfigWith(
    delegate: FusionCli,
    reportPaths: boolean,
  ): Promise<void> {
    const label = `"${this.getProjectName()}" at ${this.projectRoot.fsPath}`;
    const sourcePaths = reportPaths
      ? () => sourcePathsOf(this.paths())
      : undefined;
    if (
      await refreshCliConfig({
        cli: delegate,
        terminal: this.terminal,
        label,
        sourcePaths,
      })
    ) {
      this.diagnostics.clearConfig();
      this.updateDiagnosticsInProblemsPanel();
    }
  }

  /** Rebuilds a stale parse; resolves once the manifest is current. */
  ensureParsed(): Promise<void> {
    return this.scheduler.ensureParsed();
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
    // A parse that read the files before the latest source change does not make the parse current.
    const published = this.published.publishParsed(parsed, () =>
      this.scheduler.markParsed(),
    );
    if (!published) {
      return;
    }
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
  }

  /** Replaces the published manifest with the composite producer's merged value, stamped as the next publication. */
  publishMerged(
    merged: ParsedManifest,
    hasServerValue: boolean,
  ): Manifest | undefined {
    return this.published.publishMerged(merged, hasServerValue);
  }

  /** The last `metadata.adapter_type` a manifest carried; `"unknown"` until one has. */
  getAdapterType() {
    return this.manifestRebuild.adapterType || "unknown";
  }

  findPackageName(uri: Uri): string | undefined {
    return packageNameOf(
      this.projectRoot.toString(),
      this.paths()?.packagesInstallPath,
      uri,
    );
  }

  contains(uri: Uri) {
    return isAtOrBelow(this.projectRoot.fsPath, uri.fsPath);
  }

  withRunResults<T>(
    run: () => Promise<T>,
    launched?: readonly string[],
  ): Promise<T> {
    return withRunResults({
      reader: this.runResultsReader,
      history: this.runHistory,
      run,
      launched,
    });
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

  throwDiagnosticsErrorIfAvailable() {
    this.diagnostics.throwFirstError();
  }

  /** This project's defer settings, read from the same snapshot commands are built from. */
  getDeferConfig(): ResolvedDefer | undefined {
    return readProjectSnapshot(this.projectRoot).invocation.defer;
  }
}
