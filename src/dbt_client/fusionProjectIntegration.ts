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
  type ExecuteSQLResult,
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
import {
  buildManifest,
  ManifestParsers,
  ManifestTrigger,
} from "../projects/manifest";

export type { FusionCommandIntegrationFactory } from "../fusion/executableLifecycle";

export const FusionProjectIntegrationEvents = {
  DIAGNOSTICS_CHANGED: "diagnosticsChanged",
  PROJECT_CONFIG_CHANGED: "projectConfigChanged",
  REBUILD_MANIFEST_STATUS_CHANGE: "rebuildManifestStatusChange",
  MANIFEST_PARSED: "manifestParsed",
  SOURCE_FILE_CHANGED: "sourceFileChanged",
} as const;

/**
 * `dbt show --output json` reports no column types; the published integration fabricates
 * the literal string "string" for every column regardless of its real type. Report every
 * column type as unknown here, the one seam both `executeSQLWithLimit` and
 * `immediatelyExecuteSQLWithLimit` consumers read through, instead of forwarding that
 * placeholder.
 */
function markColumnTypesUnknown(result: ExecuteSQLResult): ExecuteSQLResult {
  return {
    ...result,
    table: {
      ...result.table,
      // Cast: the library types column_types as string[], but never returns a real type.
      column_types: result.table.column_types.map(
        () => null,
      ) as unknown as string[],
    },
  };
}

export class FusionProjectIntegration
  extends EventEmitter
  implements ManifestProject
{
  private readonly lifecycle: ExecutableLifecycle;
  /** A candidate being parsed before commit; parsers read project paths through it. */
  private parsingCandidate?: FusionCli;
  private disposed = false;
  private readonly readFailures = { count: 0 };
  private readonly parsers: ManifestParsers;
  private readonly trigger: ManifestTrigger;
  private projectConfigDiagnostics: DBTDiagnosticData[] = [];
  private adapterType = "unknown";

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
    this.parsers = {
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
          this.prepareCandidate(candidate, generation),
        deactivate: () => this.trigger.stop(),
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
    return this.parsingCandidate ?? this.lifecycle.current();
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
    return this.adapterType;
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

  private isActivationCurrent(generation: number): boolean {
    return this.lifecycle.isCurrent(generation);
  }

  /** Refreshes config and builds the manifest for a candidate; the returned step publishes it. */
  private async prepareCandidate(
    candidate: FusionCli,
    generation: number,
  ): Promise<(() => void) | undefined> {
    await this.refreshIntegrationProjectConfig(candidate, false);
    if (!this.isActivationCurrent(generation)) {
      return undefined;
    }
    let parsed: ParsedManifest | undefined;
    await this.runManifestRebuild(candidate, generation, async () => {
      parsed = await this.buildParsedManifest(candidate, generation);
    });
    const result = parsed;
    return result ? () => this.publishParsedManifest(result) : undefined;
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
    const delegate = this.requireIntegration();
    const generation = this.lifecycle.generation;
    await this.runManifestRebuild(delegate, generation, async () => {
      const parsed = await this.buildParsedManifest(delegate, generation);
      if (parsed) {
        this.publishParsedManifest(parsed);
      }
    });
  }

  private async runManifestRebuild(
    delegate: FusionCli,
    generation: number,
    afterRebuild: () => Promise<void>,
  ): Promise<void> {
    this.emit(FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE, {
      inProgress: true,
    });
    try {
      await delegate.rebuildManifest();
      if (!this.isActivationCurrent(generation)) {
        return;
      }
      this.terminal.debug(
        "FusionProjectIntegration",
        `Finished rebuilding the manifest for project at ${this.projectRoot}`,
      );
      await afterRebuild();
    } catch (error) {
      if (this.isActivationCurrent(generation)) {
        this.terminal.error(
          "FusionProjectIntegration",
          "Error rebuilding manifest",
          error,
        );
        throw error;
      }
    } finally {
      this.emit(FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE, {
        inProgress: false,
      });
    }
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    const generation = this.lifecycle.generation;
    const parsed = await this.buildParsedManifest(
      this.requireIntegration(),
      generation,
    );
    if (parsed && this.isActivationCurrent(generation)) {
      this.publishParsedManifest(parsed);
    }
    return parsed;
  }

  private publishParsedManifest(parsed: ParsedManifest): void {
    this.emit(FusionProjectIntegrationEvents.MANIFEST_PARSED, parsed);
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
  }

  private async buildParsedManifest(
    delegate: FusionCli,
    generation: number,
  ): Promise<ParsedManifest | undefined> {
    const targetPath = delegate.getTargetPath();
    if (!targetPath) {
      this.terminal.debug(
        "FusionProjectIntegration",
        "targetPath should be defined at this stage for project " +
          this.projectRoot,
      );
      return;
    }
    const previous = this.parsingCandidate;
    const isCandidate = delegate !== this.lifecycle.current();
    if (isCandidate) {
      this.parsingCandidate = delegate;
    }
    try {
      const built = await buildManifest(
        this.parsers,
        this,
        targetPath,
        this.terminal,
        this.readFailures,
      );
      if (!built || !this.isActivationCurrent(generation)) {
        return;
      }
      this.adapterType = built.adapterType ?? this.adapterType;
      return built.parsed;
    } finally {
      if (isCandidate && this.parsingCandidate === delegate) {
        this.parsingCandidate = previous;
      }
    }
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
    return this.runSql(query, modelName, limit, false);
  }

  async immediatelyExecuteSQLWithLimit(
    query: string,
    modelName: string,
    limit: number,
  ): Promise<QueryExecutionResult> {
    return this.runSql(query, modelName, limit, true);
  }

  private async runSql(
    query: string,
    modelName: string,
    limit: number,
    immediate: true,
  ): Promise<QueryExecutionResult>;
  private async runSql(
    query: string,
    modelName: string,
    limit: number,
    immediate: false,
  ): Promise<QueryExecution>;
  private async runSql(
    query: string,
    modelName: string,
    limit: number,
    immediate: boolean,
  ): Promise<QueryExecution | QueryExecutionResult> {
    let normalizedQuery = query.replace(/;\s*$/, "");
    const limitMatch = /\bLIMIT\s+(\d+)\s*(?:;?\s*(?:--[^\n]*)?\s*)$/i.exec(
      normalizedQuery,
    );
    if (limitMatch) {
      const parsedLimit = parseInt(limitMatch[1], 10);
      if (parsedLimit > 0) {
        limit = parsedLimit;
      }
      normalizedQuery = normalizedQuery.replace(limitMatch[0], "").trim();
    }
    if (limit <= 0) {
      throw new Error("Limit must be greater than 0");
    }
    const rawExecution = await this.requireIntegration().executeSQL(
      normalizedQuery,
      limit,
      modelName,
    );
    const execution = new QueryExecution(
      () => rawExecution.cancel(),
      async () => markColumnTypesUnknown(await rawExecution.executeQuery()),
    );
    if (!immediate) {
      return execution;
    }
    const result = await execution.executeQuery();
    const rows: Record<string, unknown>[] = [];
    for (let rowIndex = 0; rowIndex < result.table.rows.length; rowIndex++) {
      result.table.rows[rowIndex].forEach((value, columnIndex) => {
        rows[rowIndex] = {
          ...rows[rowIndex],
          [result.table.column_names[columnIndex]]: value,
        };
      });
    }
    return {
      columnNames: result.table.column_names,
      columnTypes: result.table.column_types,
      data: rows,
      rawSql: normalizedQuery,
      compiledSql: result.compiled_sql,
    };
  }

  async getColumnsOfModel(modelName: string) {
    return this.requireIntegration().getColumnsOfModel(modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.requireIntegration().getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    const query = `SELECT DISTINCT ${column} FROM {{ ref('${model}') }}`;
    const result = await this.immediatelyExecuteSQLWithLimit(query, model, 100);
    return result.data.map((row) => Object.values(row)[0]);
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
