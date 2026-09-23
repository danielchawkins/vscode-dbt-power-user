import { existsSync, FSWatcher, readFileSync, watch } from "fs";
import { extname, isAbsolute, join } from "path";

import {
  ChildrenParentParser,
  DBT_PROJECT_FILE,
  DBTCommand,
  DBTCommandFactory,
  type DBTConfiguration,
  type DBTDiagnosticData,
  DBTProjectIntegration,
  DBTProjectIntegrationAdapter,
  DBTTerminal,
  DeferConfig,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MANIFEST_FILE,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  ParsedManifest,
  type QueryExecution,
  type QueryExecutionResult,
  RESOURCE_TYPE_MODEL,
  RUN_RESULTS_FILE,
  type RunResultsEventData,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "@altimateai/dbt-integration";
import { EventEmitter } from "events";
import { YAMLError } from "yaml";

/** Parser-facing project context; upstream types require the adapter class name. */
export interface ManifestParserProjectContext {
  getProjectRoot(): string;
  getProjectName(): string;
  getPackageInstallPath(): string | undefined;
  getTargetPath(): string | undefined;
}

/** Snapshot of run_results.json content before a command; null when absent. */
export type RunResultsObservation = string | null;

export const FusionProjectIntegrationEvents = {
  DIAGNOSTICS_CHANGED: "diagnosticsChanged",
  PROJECT_CONFIG_CHANGED: "projectConfigChanged",
  REBUILD_MANIFEST_STATUS_CHANGE: "rebuildManifestStatusChange",
  MANIFEST_PARSED: "manifestParsed",
  SOURCE_FILE_CHANGED: "sourceFileChanged",
  RUN_RESULTS_PARSED: "runResultsParsed",
} as const;

interface DebouncedHandler {
  schedule: () => void;
  cancel: () => void;
}

function createDebounced(fn: () => void, ms: number): DebouncedHandler {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule: () => {
      clearTimeout(timeout);
      timeout = setTimeout(fn, ms);
    },
    cancel: () => {
      clearTimeout(timeout);
      timeout = undefined;
    },
  };
}

function asParserProject(
  ctx: ManifestParserProjectContext,
): DBTProjectIntegrationAdapter {
  return ctx as DBTProjectIntegrationAdapter;
}

type FunctionParserInput = Parameters<
  FunctionParser["createFunctionMetaMap"]
>[0];

const EMPTY_FUNCTION_MAP = {} as FunctionParserInput;

interface ManifestJson {
  nodes: Record<string, unknown>;
  sources: Record<string, unknown>;
  macros: Record<string, unknown>;
  semantic_models: Record<string, unknown>;
  docs: Record<string, unknown>;
  exposures: Record<string, unknown>;
  functions?: Record<string, unknown>;
  unit_tests?: Record<string, unknown>;
}

interface RawRunResults {
  metadata?: { invocation_id?: string; generated_at?: string };
  args?: {
    which?: string;
    select?: string | string[];
    exclude?: string | string[];
    selector?: string | string[];
    full_refresh?: boolean;
    defer?: boolean;
    state?: string;
    target?: string;
  };
  results?: Array<{
    unique_id: string;
    status: string;
    execution_time?: number | null;
    message?: string;
  }>;
  elapsed_time?: number;
}

function normalizeStringOrArray(
  value: string | string[] | undefined,
): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function resolveRunStatus(
  status: string,
): RunResultsEventData["results"][0]["status"] {
  switch (status) {
    case "success":
    case "pass":
      return "success";
    case "error":
    case "fail":
      return "error";
    case "warn":
      return "warn";
    default:
      return "skipped";
  }
}

function parseRunResultsJson(
  raw: unknown,
  projectName: string,
): RunResultsEventData {
  const data = raw as RawRunResults;
  if (
    !data.metadata?.invocation_id ||
    !data.metadata?.generated_at ||
    !data.args?.which
  ) {
    throw new Error(
      "Malformed run_results.json: missing required fields (metadata.invocation_id, metadata.generated_at, or args.which)",
    );
  }
  const which = data.args.which;
  const parts = [`dbt ${which}`];
  const select = normalizeStringOrArray(data.args.select);
  if (select.length > 0) {
    parts.push(`--select ${select.join(" ")}`);
  }
  const exclude = normalizeStringOrArray(data.args.exclude);
  if (exclude.length > 0) {
    parts.push(`--exclude ${exclude.join(" ")}`);
  }
  const selector = normalizeStringOrArray(data.args.selector);
  if (selector.length > 0) {
    parts.push(`--selector ${selector.join(" ")}`);
  }
  if (data.args.full_refresh === true) {
    parts.push("--full-refresh");
  }
  if (data.args.defer === true) {
    parts.push("--defer");
  }
  if (data.args.state) {
    parts.push(`--state ${data.args.state}`);
  }
  if (data.args.target) {
    parts.push(`--target ${data.args.target}`);
  }
  const args = select;
  const results = Array.isArray(data.results)
    ? data.results.map((entry) => ({
        name: entry.unique_id.split(".").pop() ?? entry.unique_id,
        uniqueId: entry.unique_id,
        status: resolveRunStatus(entry.status),
        executionTime: entry.execution_time ?? null,
        message: entry.message,
        resourceType: entry.unique_id.split(
          ".",
        )[0] as RunResultsEventData["results"][0]["resourceType"],
      }))
    : [];
  return {
    id: data.metadata.invocation_id,
    command: parts.join(" "),
    args,
    completedAt: new Date(data.metadata.generated_at),
    projectName,
    results,
    elapsedTime: data.elapsed_time ?? 0,
  };
}

export class FusionProjectIntegration
  extends EventEmitter
  implements ManifestParserProjectContext
{
  private readonly currentIntegration: DBTProjectIntegration;
  private consecutiveReadFailures = 0;
  private sourceFileWatchers: FSWatcher[] = [];
  private currentSourcePaths?: string[];
  private isWatchingSourceFiles = false;
  private projectConfigWatcher?: FSWatcher;
  private sourceFilesDebounced?: DebouncedHandler;
  private projectConfigDebounced?: DebouncedHandler;
  private projectConfigDiagnostics: DBTDiagnosticData[] = [];
  private lastParsedManifest?: ParsedManifest;
  private deferConfig: DeferConfig;

  constructor(
    private readonly dbtConfiguration: DBTConfiguration,
    private readonly dbtCommandFactory: DBTCommandFactory,
    private readonly dbtFusionIntegrationFactory: (
      projectRoot: string,
      diagnostics: DBTDiagnosticData[],
      deferConfig: DeferConfig,
      onDiagnosticsChanged: () => void,
    ) => DBTProjectIntegration,
    private readonly projectRoot: string,
    deferConfig: DeferConfig | undefined,
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
    this.deferConfig = deferConfig ?? this.getDefaultDeferConfig();
    this.currentIntegration = this.createIntegration();
  }

  private createIntegration(): DBTProjectIntegration {
    return this.dbtFusionIntegrationFactory(
      this.projectRoot,
      this.projectConfigDiagnostics,
      this.deferConfig,
      () => this.emit(FusionProjectIntegrationEvents.DIAGNOSTICS_CHANGED),
    );
  }

  getProjectName(): string {
    return this.currentIntegration.getProjectName();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getDefaultDeferConfig(): DeferConfig {
    return DeferConfig.createFusionDefaults();
  }

  getDBTProjectFilePath(): string {
    return join(this.projectRoot, DBT_PROJECT_FILE);
  }

  getTargetPath(): string | undefined {
    return this.currentIntegration.getTargetPath();
  }

  getPackageInstallPath(): string | undefined {
    return this.currentIntegration.getPackageInstallPath();
  }

  getModelPaths(): string[] | undefined {
    return this.currentIntegration.getModelPaths();
  }

  getSeedPaths(): string[] | undefined {
    return this.currentIntegration.getSeedPaths();
  }

  getMacroPaths(): string[] | undefined {
    return this.currentIntegration.getMacroPaths();
  }

  getAdapterType(): string {
    return this.currentIntegration.getAdapterType() || "unknown";
  }

  getDeferConfig(): DeferConfig {
    return this.deferConfig;
  }

  async applyDeferConfig(deferConfig: DeferConfig | undefined): Promise<void> {
    this.deferConfig = deferConfig ?? this.getDefaultDeferConfig();
    await this.currentIntegration.applyDeferConfig(this.deferConfig);
  }

  getCurrentProjectIntegration(): DBTProjectIntegration {
    return this.currentIntegration;
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
    await this.currentIntegration.initializeProject();
    await this.refreshProjectConfig();
    this.emit(FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED);
    await this.rebuildManifest();
    this.startProjectConfigWatcher();
    this.startSourceFilesWatcher();
  }

  async refreshProjectConfig(): Promise<void> {
    this.terminal.debug(
      "FusionProjectIntegration",
      `Going to refresh the project "${this.getProjectName()}" at ${this.projectRoot} configuration`,
    );
    try {
      await this.currentIntegration.refreshProjectConfig();
      this.clearProjectConfigDiagnostics();
    } catch (error) {
      const projectFile = this.getDBTProjectFilePath();
      if (error instanceof YAMLError) {
        this.addProjectConfigDiagnostic({
          filePath: projectFile,
          message: "dbt_project.yml is invalid : " + error.message,
          severity: "error",
          range: {
            startLine: 0,
            startColumn: 0,
            endLine: 999,
            endColumn: 999,
          },
          source: "dbt-project",
          category: "project-config",
        });
      }
      this.terminal.debug(
        "FusionProjectIntegration",
        `An error occurred while trying to refresh the project "${this.getProjectName()}" at ${this.projectRoot} configuration`,
        error,
      );
      return;
    }
    this.updateSourceFilesWatchers();
    const modelPaths = this.getModelPaths();
    const macroPaths = this.getMacroPaths();
    const seedPaths = this.getSeedPaths();
    if (modelPaths && macroPaths && seedPaths) {
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
    this.emit(FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE, {
      inProgress: true,
    });
    try {
      await this.currentIntegration.rebuildManifest();
      this.terminal.debug(
        "FusionProjectIntegration",
        `Finished rebuilding the manifest for project at ${this.projectRoot}`,
      );
      await this.parseManifest();
    } catch (error) {
      this.terminal.error(
        "FusionProjectIntegration",
        "Error rebuilding manifest",
        error,
      );
      throw error;
    } finally {
      this.emit(FusionProjectIntegrationEvents.REBUILD_MANIFEST_STATUS_CHANGE, {
        inProgress: false,
      });
    }
  }

  async parseManifest(): Promise<ParsedManifest | undefined> {
    this.terminal.debug(
      "FusionProjectIntegration",
      `Going to parse manifest for project at ${this.projectRoot}`,
    );
    const targetPath = this.getTargetPath();
    if (!targetPath) {
      this.terminal.debug(
        "FusionProjectIntegration",
        "targetPath should be defined at this stage for project " +
          this.projectRoot,
      );
      return;
    }
    const manifestJson = this.readAndParseManifestFile(targetPath);
    if (manifestJson === undefined) {
      return;
    }
    const parserProject = asParserProject(this);
    // manifest.json stores resource maps as objects; published parser types say arrays.
    const {
      nodes,
      sources,
      macros,
      semantic_models: semanticModels,
      docs,
      exposures,
      functions: functionRecords,
      unit_tests: unitTests,
    } = manifestJson as unknown as {
      nodes: Parameters<NodeParser["createNodeMetaMap"]>[0];
      sources: Parameters<SourceParser["createSourceMetaMap"]>[0];
      macros: Parameters<MacroParser["createMacroMetaMap"]>[0];
      semantic_models: Parameters<
        SemanticModelParser["createSemanticModelMetaMap"]
      >[0];
      docs: Parameters<DocParser["createDocMetaMap"]>[0];
      exposures: Parameters<ExposureParser["createExposureMetaMap"]>[0];
      functions?: Parameters<FunctionParser["createFunctionMetaMap"]>[0];
      unit_tests?: Parameters<UnitTestParser["createUnitTestMetaMap"]>[0];
    };
    const parentMapsPromise =
      this.childrenParentParser.createChildrenParentMetaMap(
        { ...nodes, ...exposures, ...(functionRecords ?? {}) },
        sources,
      );
    const nodeMetaMapPromise = this.nodeParser.createNodeMetaMap(
      nodes,
      parserProject,
    );
    const macroMetaMapPromise = this.macroParser.createMacroMetaMap(
      macros,
      parserProject,
    );
    const metricMetaMapPromise = this.metricParser.createMetricMetaMap(
      semanticModels,
      parserProject,
    );
    const semanticModelMetaMapPromise =
      this.semanticModelParser.createSemanticModelMetaMap(
        semanticModels,
        parserProject,
      );
    const sourceMetaMapPromise = this.sourceParser.createSourceMetaMap(
      sources,
      parserProject,
    );
    const testMetaMapPromise = this.testParser.createTestMetaMap(
      nodes,
      parserProject,
    );
    const unitTestMetaMapPromise = this.unitTestParser.createUnitTestMetaMap(
      unitTests ?? {},
      parserProject,
    );
    const docMetaMapPromise = this.docParser.createDocMetaMap(
      docs,
      parserProject,
    );
    const exposureMetaMapPromise = this.exposureParser.createExposureMetaMap(
      exposures,
      parserProject,
    );
    const functionMetaMapPromise = this.functionParser.createFunctionMetaMap(
      functionRecords ?? EMPTY_FUNCTION_MAP,
      parserProject,
    );
    const [
      { parentMetaMap, childMetaMap, constraintOnlyParents },
      nodeMetaMap,
      macroMetaMap,
      metricMetaMap,
      semanticModelMetaMap,
      sourceMetaMap,
      testMetaMap,
      unitTestMetaMap,
      docMetaMap,
      exposureMetaMap,
      functionMetaMap,
    ] = await Promise.all([
      parentMapsPromise,
      nodeMetaMapPromise,
      macroMetaMapPromise,
      metricMetaMapPromise,
      semanticModelMetaMapPromise,
      sourceMetaMapPromise,
      testMetaMapPromise,
      unitTestMetaMapPromise,
      docMetaMapPromise,
      exposureMetaMapPromise,
      functionMetaMapPromise,
    ]);
    const modelDepthMap = this.modelDepthParser.createModelDepthsMap(
      nodes,
      parentMetaMap,
      childMetaMap,
    );
    const graphMetaMap = this.graphParser.createGraphMetaMap(
      parserProject,
      parentMetaMap,
      childMetaMap,
      nodeMetaMap,
      sourceMetaMap,
      testMetaMap,
      functionMetaMap,
      constraintOnlyParents,
    );
    const parsed: ParsedManifest = {
      nodeMetaMap,
      macroMetaMap,
      metricMetaMap,
      sourceMetaMap,
      graphMetaMap,
      testMetaMap,
      unitTestMetaMap,
      docMetaMap,
      exposureMetaMap,
      functionMetaMap,
      semanticModelMetaMap,
      modelDepthMap,
    };
    this.lastParsedManifest = parsed;
    this.emit(FusionProjectIntegrationEvents.MANIFEST_PARSED, parsed);
    this.terminal.debug(
      "manifestParsed",
      "manifest succesfully parsed",
      parsed,
    );
    return parsed;
  }

  private readAndParseManifestFile(
    targetPath: string,
  ): ManifestJson | undefined {
    const segments = isAbsolute(targetPath)
      ? [targetPath]
      : [this.projectRoot, targetPath];
    const manifestPath = join(...segments, MANIFEST_FILE);
    this.terminal.debug(
      "FusionProjectIntegration",
      `Reading manifest at ${manifestPath} for project at ${this.projectRoot}`,
    );
    try {
      const contents = readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(contents) as ManifestJson;
      this.consecutiveReadFailures = 0;
      return parsed;
    } catch (error) {
      this.consecutiveReadFailures++;
      if (this.consecutiveReadFailures > 3) {
        this.terminal.error(
          "FusionProjectIntegration",
          `Could not read/parse manifest file at ${manifestPath} after ${this.consecutiveReadFailures} attempts`,
          error,
        );
      }
      return undefined;
    }
  }

  observeRunResultsBeforeCommand(): RunResultsObservation {
    return this.readRunResultsSnapshot();
  }

  /** Post-command read of run_results.json; no ambient target watcher. */
  parseRunResultsAfterCommand(
    before: RunResultsObservation,
  ): RunResultsEventData | null {
    const after = this.readRunResultsSnapshot();
    if (after === null) {
      this.terminal.trace("Run results file does not exist after command");
      return null;
    }
    if (after === before) {
      this.terminal.trace("Ignoring unchanged run_results.json after command");
      return null;
    }
    try {
      const event = parseRunResultsJson(
        JSON.parse(after),
        this.getProjectName(),
      );
      this.emit(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, event);
      this.terminal.debug(
        "runResultsParsed",
        "Run results successfully parsed",
        event,
      );
      return event;
    } catch (error) {
      this.terminal.error(
        "FusionProjectIntegration",
        `Unable to parse run_results.json: ${(error as Error).message}`,
        error,
      );
      return null;
    }
  }

  private readRunResultsSnapshot(): RunResultsObservation {
    const targetPath = this.getTargetPath();
    if (!targetPath) {
      return null;
    }
    const runResultsPath = join(targetPath, RUN_RESULTS_FILE);
    if (!existsSync(runResultsPath)) {
      return null;
    }
    try {
      const raw = readFileSync(runResultsPath, "utf8");
      return raw || null;
    } catch {
      return null;
    }
  }

  getDebounceForRebuildManifest(): number {
    return this.currentIntegration.getDebounceForRebuildManifest?.() ?? 500;
  }

  private startSourceFilesWatcher(): void {
    if (this.isWatchingSourceFiles) {
      return;
    }
    this.terminal.debug(
      "FusionProjectIntegration",
      `Starting Node.js file watchers for project at ${this.projectRoot}`,
    );
    this.isWatchingSourceFiles = true;
    this.setupSourceFileWatchers();
  }

  private stopFileWatching(): void {
    if (!this.isWatchingSourceFiles) {
      return;
    }
    this.terminal.debug(
      "FusionProjectIntegration",
      `Stopping Node.js file watchers for project at ${this.projectRoot}`,
    );
    this.disposeSourceFileWatchers();
    this.isWatchingSourceFiles = false;
  }

  private updateSourceFilesWatchers(): void {
    if (!this.isWatchingSourceFiles) {
      return;
    }
    const modelPaths = this.getModelPaths();
    const macroPaths = this.getMacroPaths();
    const seedPaths = this.getSeedPaths();
    if (!modelPaths || !macroPaths || !seedPaths) {
      this.terminal.debug(
        "FusionProjectIntegration",
        "Cannot update file watchers - source paths not available",
      );
      return;
    }
    const paths = [...modelPaths, ...macroPaths, ...seedPaths];
    if (
      this.currentSourcePaths &&
      this.arrayEquals(this.currentSourcePaths, paths)
    ) {
      return;
    }
    this.terminal.debug(
      "FusionProjectIntegration",
      "Updating Node.js file watchers with new paths",
      paths,
    );
    this.disposeSourceFileWatchers();
    this.currentSourcePaths = paths;
    this.setupSourceFileWatchers();
  }

  private setupSourceFileWatchers(): void {
    if (!this.currentSourcePaths) {
      const modelPaths = this.getModelPaths();
      const macroPaths = this.getMacroPaths();
      const seedPaths = this.getSeedPaths();
      if (!modelPaths || !macroPaths || !seedPaths) {
        this.terminal.debug(
          "FusionProjectIntegration",
          "Cannot setup file watchers - source paths not available",
        );
        return;
      }
      this.currentSourcePaths = [...modelPaths, ...macroPaths, ...seedPaths];
    }
    this.sourceFilesDebounced?.cancel();
    this.sourceFilesDebounced = createDebounced(async () => {
      this.terminal.debug(
        "FusionProjectIntegration",
        `SourceFileChanged event fired for "${this.getProjectName()}" at ${this.projectRoot}`,
      );
      this.emit(FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED);
      try {
        await this.rebuildManifest();
      } catch (error) {
        this.terminal.error(
          "FusionProjectIntegrationError",
          `Failed to rebuild manifest after file change: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        );
      }
    }, this.getDebounceForRebuildManifest());
    for (const sourcePath of this.currentSourcePaths) {
      try {
        const watcher = watch(
          sourcePath,
          { recursive: true },
          (_event, filename) => {
            if (filename && this.isDbtFile(filename)) {
              this.terminal.debug(
                "FusionProjectIntegration",
                `File change in ${sourcePath}: ${filename}`,
              );
              this.sourceFilesDebounced?.schedule();
            }
          },
        );
        this.sourceFileWatchers.push(watcher);
        this.terminal.debug(
          "FusionProjectIntegration",
          `Started Node.js file watcher for ${sourcePath}`,
        );
      } catch (error) {
        this.terminal.error(
          "FusionProjectIntegration",
          `Failed to create file watcher for ${sourcePath}`,
          error,
        );
      }
    }
  }

  private disposeSourceFileWatchers(): void {
    this.sourceFilesDebounced?.cancel();
    for (const watcher of this.sourceFileWatchers) {
      try {
        watcher.close();
      } catch (error) {
        this.terminal.error(
          "FusionProjectIntegration",
          "Error closing file watcher",
          error,
        );
      }
    }
    this.sourceFileWatchers = [];
  }

  private isDbtFile(filename: string): boolean {
    const extension = extname(filename).toLowerCase();
    return [".sql", ".yml", ".yaml", ".csv"].includes(extension);
  }

  private arrayEquals(left: string[], right: string[]): boolean {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  private startProjectConfigWatcher(): void {
    if (this.projectConfigWatcher) {
      return;
    }
    const projectFile = this.getDBTProjectFilePath();
    this.terminal.debug(
      "FusionProjectIntegration",
      `Starting Node.js project config watcher for ${projectFile}`,
    );
    try {
      this.projectConfigDebounced?.cancel();
      this.projectConfigDebounced = createDebounced(async () => {
        this.terminal.debug(
          "FusionProjectIntegration",
          "dbt_project.yml changed, refreshing project config",
        );
        try {
          await this.refreshProjectConfig();
          this.emit(FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED);
          await this.rebuildManifest();
        } catch (error) {
          this.terminal.error(
            "FusionProjectIntegration",
            "Error refreshing project config after file change",
            error,
          );
        }
      }, 500);
      this.projectConfigWatcher = watch(projectFile, (event) => {
        if (event === "change") {
          this.terminal.debug(
            "FusionProjectIntegration",
            `dbt_project.yml ${event} detected`,
          );
          this.projectConfigDebounced?.schedule();
        }
      });
      this.terminal.debug(
        "FusionProjectIntegration",
        `Started Node.js project config watcher for ${projectFile}`,
      );
    } catch (error) {
      this.terminal.error(
        "FusionProjectIntegration",
        `Failed to create project config watcher for ${projectFile}`,
        error,
      );
    }
  }

  private stopProjectConfigWatcher(): void {
    this.projectConfigDebounced?.cancel();
    if (!this.projectConfigWatcher) {
      return;
    }
    try {
      this.projectConfigWatcher.close();
      this.projectConfigWatcher = undefined;
      this.terminal.debug(
        "FusionProjectIntegration",
        "Stopped Node.js project config watcher",
      );
    } catch (error) {
      this.terminal.error(
        "FusionProjectIntegration",
        "Error closing project config watcher",
        error,
      );
    }
  }

  private async runImmediately(command: DBTCommand) {
    command.focus = false;
    command.showProgress = false;
    command.logToTerminal = false;
    const before = this.observeRunResultsBeforeCommand();
    const result =
      await this.currentIntegration.executeCommandImmediately(command);
    this.parseRunResultsAfterCommand(before);
    return result;
  }

  async unsafeCompileNode(modelName: string) {
    return this.currentIntegration.unsafeCompileNode(modelName);
  }

  async unsafeCompileQuery(query: string, originalModelName?: string) {
    return this.currentIntegration.unsafeCompileQuery(query, originalModelName);
  }

  async installDeps() {
    const command = this.dbtCommandFactory.createInstallDepsCommand();
    return this.runImmediately(command);
  }

  clean() {
    return this.runImmediately(this.dbtCommandFactory.createCleanCommand());
  }

  debug(focus = true) {
    const command = this.dbtCommandFactory.createDebugCommand(focus);
    command.showProgress = false;
    command.logToTerminal = false;
    return this.currentIntegration.executeCommandImmediately(command);
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
    const execution = await this.currentIntegration.executeSQL(
      normalizedQuery,
      limit,
      modelName,
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
    return this.currentIntegration.getColumnsOfModel(modelName);
  }

  async getColumnsOfSource(sourceName: string, tableName: string) {
    return this.currentIntegration.getColumnsOfSource(sourceName, tableName);
  }

  async getColumnValues(model: string, column: string) {
    const query = `SELECT DISTINCT ${column} FROM {{ ref('${model}') }}`;
    const result = await this.immediatelyExecuteSQLWithLimit(query, model, 100);
    return result.data.map((row) => Object.values(row)[0]);
  }

  getNonEphemeralParents(keys: string[]): string[] {
    if (!this.lastParsedManifest) {
      throw Error(
        "No manifest has been generated. Maybe dbt project has not been parsed yet?",
      );
    }
    const { nodeMetaMap, graphMetaMap } = this.lastParsedManifest;
    const { parents } = graphMetaMap;
    const result = new Set<string>();
    const queue = [...keys];
    const visited: Record<string, boolean> = {};
    while (queue.length > 0) {
      const key = queue.shift();
      if (!key || visited[key]) {
        continue;
      }
      visited[key] = true;
      const parentEntry = parents.get(key);
      if (!parentEntry) {
        continue;
      }
      for (const node of parentEntry.nodes) {
        if (node.key.split(".")[0] !== RESOURCE_TYPE_MODEL) {
          result.add(node.key);
          continue;
        }
        const nodeMeta = nodeMetaMap.lookupByUniqueId(node.key);
        if (nodeMeta?.config.materialized === "ephemeral") {
          queue.push(node.key);
        } else {
          result.add(node.key);
        }
      }
    }
    return Array.from(result);
  }

  async dispose(): Promise<void> {
    this.stopFileWatching();
    this.stopProjectConfigWatcher();
    await this.currentIntegration.dispose();
    this.removeAllListeners();
  }
}
