import { EventEmitter } from "events";
import {
  dbtProjectFilePath,
  declaredProjectName,
  readDbtProjectFile,
} from "../core/project";
import {
  ChildrenParentParser,
  type DBTDiagnosticData,
  type DBTDiagnosticResult,
  DBTTerminal,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  type ManifestProject,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  ParsedManifest,
  QueryExecution,
  type QueryExecutionResult,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../dbt_integration";
import {
  EXECUTABLE_DIAGNOSTIC_SOURCE,
  ExecutableLifecycle,
  FusionCommandIntegrationFactory,
} from "../fusion/executableLifecycle";
import { FusionCli } from "../fusion/fusionCli";
import { FusionExecutableResolver } from "../fusion/fusionExecutable";
import { FusionVersion } from "../fusion/fusionVersion";
import { ManifestParsers, ManifestTrigger } from "../projects/manifest";
import { ManifestRebuild } from "../projects/manifestRebuild";
import { executeSql, getColumnValues } from "../projects/projectSql";

export type { FusionCommandIntegrationFactory } from "../fusion/executableLifecycle";

export const FusionProjectIntegrationEvents = {
  DIAGNOSTICS_CHANGED: "diagnosticsChanged",
  PROJECT_CONFIG_CHANGED: "projectConfigChanged",
  REBUILD_MANIFEST_STATUS_CHANGE: "rebuildManifestStatusChange",
  MANIFEST_PARSED: "manifestParsed",
  SOURCE_FILE_CHANGED: "sourceFileChanged",
} as const;

export class FusionProjectIntegration
  extends EventEmitter
  implements ManifestProject
{
  private readonly lifecycle: ExecutableLifecycle;
  private readonly manifest: ManifestRebuild;
  private disposed = false;
  private readonly trigger: ManifestTrigger;
  private projectConfigDiagnostics: DBTDiagnosticData[] = [];

  constructor(
    resolver: FusionExecutableResolver,
    fusionIntegrationFactory: FusionCommandIntegrationFactory,
    private readonly projectRoot: string,
    private readonly childrenParentParser: ChildrenParentParser,
    private readonly nodeParser: NodeParser,
    private readonly macroParser: MacroParser,
    private readonly metricParser: MetricParser,
    private readonly graphParser: GraphParser,
    private readonly sourceParser: SourceParser,
    private readonly testParser: TestParser,
    private readonly unitTestParser: UnitTestParser,
    private readonly exposureParser: ExposureParser,
    private readonly functionParser: FunctionParser,
    private readonly docParser: DocParser,
    private readonly terminal: DBTTerminal,
    private readonly modelDepthParser: ModelDepthParser,
    private readonly semanticModelParser: SemanticModelParser,
  ) {
    super();
    const parsers: ManifestParsers = {
      childrenParentParser,
      nodeParser,
      macroParser,
      metricParser,
      graphParser,
      sourceParser,
      testParser,
      unitTestParser,
      exposureParser,
      functionParser,
      docParser,
      modelDepthParser,
      semanticModelParser,
    };
    this.trigger = new ManifestTrigger(projectRoot, terminal, {
      sourcePaths: () => this.sourcePaths(),
      onProjectFileChanged: () => this.onProjectFileChanged(),
      onSourceFileChanged: () => this.onSourceFileChanged(),
    });
    this.lifecycle = new ExecutableLifecycle(
      resolver,
      fusionIntegrationFactory,
      projectRoot,
      terminal,
      {
        activate: (candidate, generation) =>
          this.manifest.prepareCandidate(candidate, generation),
        deactivate: () => this.trigger.stop(),
      },
    );
    this.manifest = new ManifestRebuild(
      this.lifecycle,
      parsers,
      this,
      terminal,
      {
        refreshConfig: (candidate) =>
          this.refreshIntegrationProjectConfig(candidate, false),
        onStatus: (inProgress) =>
          this.emit(
            FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE,
            { inProgress },
          ),
        onParsed: (parsed) => this.publishParsedManifest(parsed),
      },
    );
    this.lifecycle.onDidCommit(() => {
      this.emit(FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED);
      this.trigger.start();
    });
    this.lifecycle.onDidFailResolution((diagnostic) => {
      this.clearExecutableResolutionDiagnostics();
      if (diagnostic) {
        this.addProjectConfigDiagnostic(diagnostic);
      }
    });
  }

  private get currentIntegration(): FusionCli | undefined {
    if (this.disposed) {
      return undefined;
    }
    return this.manifest.candidate() ?? this.lifecycle.current();
  }

  private requireIntegration(): FusionCli {
    const integration = this.currentIntegration;
    if (!integration) {
      throw new Error(
        `Fusion CLI integration is not initialized for ${this.projectRoot}`,
      );
    }
    return integration;
  }

  private readProjectNameFromConfig(): string {
    return (
      declaredProjectName(readDbtProjectFile(this.projectRoot).config) ??
      this.projectRoot.split(/[/\\]/).pop() ??
      this.projectRoot
    );
  }

  getProjectName(): string {
    return (
      this.currentIntegration?.getProjectName() ??
      this.readProjectNameFromConfig()
    );
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getDBTProjectFilePath(): string {
    return dbtProjectFilePath(this.projectRoot);
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

  /** The last `metadata.adapter_type` a manifest carried; `"unknown"` until one has. */
  getAdapterType(): string {
    return this.manifest.adapterType;
  }

  /** The CLI of the committed executable; throws until one is committed. */
  getFusionCli(): FusionCli {
    return this.requireIntegration();
  }

  getDiagnostics(): DBTDiagnosticResult {
    const delegate = this.currentIntegration?.getDiagnostics();
    return {
      projectConfigDiagnostics: [...this.projectConfigDiagnostics],
      rebuildManifestDiagnostics: delegate?.rebuildManifestDiagnostics ?? [],
    };
  }

  private addProjectConfigDiagnostic(diagnostic: DBTDiagnosticData): void {
    this.projectConfigDiagnostics.push(diagnostic);
    this.emit(FusionProjectIntegrationEvents.DIAGNOSTICS_CHANGED);
  }

  private clearProjectConfigDiagnostics(): void {
    this.projectConfigDiagnostics.length = 0;
    this.emit(FusionProjectIntegrationEvents.DIAGNOSTICS_CHANGED);
  }

  async initialize(): Promise<void> {
    await this.lifecycle.initialize();
  }

  private clearExecutableResolutionDiagnostics(): void {
    let removed = false;
    for (
      let index = this.projectConfigDiagnostics.length - 1;
      index >= 0;
      index--
    ) {
      if (
        this.projectConfigDiagnostics[index].source ===
        EXECUTABLE_DIAGNOSTIC_SOURCE
      ) {
        this.projectConfigDiagnostics.splice(index, 1);
        removed = true;
      }
    }
    if (removed) {
      this.emit(FusionProjectIntegrationEvents.DIAGNOSTICS_CHANGED);
    }
  }

  async refreshProjectConfig(): Promise<void> {
    await this.refreshIntegrationProjectConfig(this.requireIntegration(), true);
  }

  private async refreshIntegrationProjectConfig(
    delegate: FusionCli,
    reportPaths: boolean,
  ): Promise<void> {
    this.terminal.debug(
      "FusionProjectIntegration",
      `Going to refresh the project "${this.getProjectName()}" at ${this.projectRoot} configuration`,
    );
    try {
      await delegate.refreshProjectConfig();
      this.clearProjectConfigDiagnostics();
    } catch (error) {
      this.terminal.debug(
        "FusionProjectIntegration",
        `An error occurred while trying to refresh the project "${this.getProjectName()}" at ${this.projectRoot} configuration`,
        error,
      );
      return;
    }
    if (!reportPaths) {
      return;
    }
    if (this.sourcePaths()) {
      this.terminal.debug(
        "FusionProjectIntegration",
        `Project config refreshed successfully for "${this.getProjectName()}" at ${this.projectRoot}`,
      );
    } else {
      this.terminal.warn(
        "FusionProjectIntegration",
        "Could not complete project config refresh because project is not initialized properly. dbt path settings cannot be determined",
      );
    }
  }

  async rebuildManifest(): Promise<void> {
    this.terminal.debug(
      "FusionProjectIntegration",
      `Going to rebuild the manifest for project at ${this.projectRoot}`,
    );
    await this.manifest.rebuild(this.requireIntegration());
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    return this.manifest.parse(this.requireIntegration());
  }

  private publishParsedManifest(parsed: ParsedManifest): void {
    this.emit(FusionProjectIntegrationEvents.MANIFEST_PARSED, parsed);
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
  }

  private async onProjectFileChanged(): Promise<void> {
    await this.refreshProjectConfig();
    this.emit(FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED);
    await this.rebuildManifest();
  }

  private async onSourceFileChanged(): Promise<void> {
    this.emit(FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED);
    await this.rebuildManifest();
  }

  private sourcePaths(): string[] | undefined {
    const modelPaths = this.getModelPaths();
    const macroPaths = this.getMacroPaths();
    const seedPaths = this.getSeedPaths();
    if (!modelPaths || !macroPaths || !seedPaths) {
      return undefined;
    }
    return [...modelPaths, ...macroPaths, ...seedPaths];
  }

  async unsafeCompileQuery(query: string) {
    return this.requireIntegration().compileInline(query);
  }

  /** Version of the Fusion executable behind the active integration, once one is committed. */
  getFusionVersion(): FusionVersion | undefined {
    return this.currentIntegration ? this.lifecycle.version : undefined;
  }

  installDeps() {
    return this.requireIntegration().run({ kind: "deps" });
  }

  clean() {
    return this.requireIntegration().run({ kind: "clean" });
  }

  debug() {
    return this.requireIntegration().run({ kind: "debug" });
  }

  async executeSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecution> {
    return executeSql(
      this.requireIntegration(),
      query,
      modelName,
      limit,
      false,
    );
  }

  async immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    return executeSql(this.requireIntegration(), query, modelName, limit, true);
  }

  async getColumnsOfModel(modelName: string) {
    return this.requireIntegration().getColumnsOfModel(modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.requireIntegration().getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    return getColumnValues(this.requireIntegration(), model, column);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.trigger.dispose();
    await this.lifecycle.dispose();
    this.removeAllListeners();
  }
}
