import * as crypto from "crypto";
import { existsSync, readFileSync } from "fs";
import path from "path";

import { parse } from "yaml";

import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
  CommandProcessResult,
} from "./commandProcessExecution";
import { DBTConfiguration } from "./configuration";
import { DBTDiagnosticResult } from "./diagnostics";
import {
  Catalog,
  DBColumn,
  DBT_PROJECT_FILE,
  DBTNode,
  DEFAULT_PACKAGES_INSTALL_DIR,
  EXCLUDED_PROJECT_DIRS,
  ManifestPathType,
  NodeMetaData,
  RunModelParams,
  SqlDryRunResult,
} from "./domain";
import { FusionProcessEnvironment } from "./fusionProcessEnvironment";
import { DBTTerminal } from "./terminal";

/** Per-project defer settings; only local state directories are supported. */
export class DeferConfig {
  constructor(
    public deferToProduction: boolean,
    public favorState: boolean,
    public manifestPathForDeferral?: string,
    public manifestPathType?: ManifestPathType,
  ) {}

  static createFusionDefaults(): DeferConfig {
    return new DeferConfig(false, false);
  }
}

function combineAbortSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  // Filter out undefined signals
  const validSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );

  if (validSignals.length === 0) {
    return undefined;
  }

  if (validSignals.length === 1) {
    return validSignals[0];
  }

  // Create a combined signal if multiple signals are provided
  const controller = new AbortController();
  const combinedSignal = controller.signal;

  validSignals.forEach((signal) => {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort());
    }
  });

  return combinedSignal;
}

export interface DBTProjectConfig {
  name: string;
  version?: string;
  profile?: string;
  model_paths?: string[];
  analysis_paths?: string[];
  test_paths?: string[];
  seed_paths?: string[];
  macro_paths?: string[];
  snapshot_paths?: string[];
  target_path?: string;
  clean_targets?: string[];
  log_path?: string;
  packages_install_path?: string;
}

export function readAndParseProjectConfig(
  projectRoot: string,
): DBTProjectConfig {
  const dbtProjectConfigLocation = path.join(projectRoot, DBT_PROJECT_FILE);
  const dbtProjectYamlFile = readFileSync(dbtProjectConfigLocation, "utf8");
  return parse(dbtProjectYamlFile, {
    strict: false,
    uniqueKeys: false,
    maxAliasCount: -1,
  }) as unknown as DBTProjectConfig;
}

/**
 * Resolve a project's `packages-install-path` without running dbt.
 *
 * Synchronous by design: callers decide whether to register a project on hot
 * paths (file watchers firing while `dbt deps` writes package files) and cannot
 * await an adapter. Falls back to `<projectDirectory>/dbt_packages` — dbt's
 * default — when the file is absent, unparseable, or does not configure a path.
 *
 * A malformed `dbt_project.yml` must not throw here: callers use this to decide
 * what to *skip*, and an exception would abort discovery entirely rather than
 * let the caller surface a per-project diagnostic.
 */
export function resolvePackagesInstallPath(
  projectDirectory: string,
  onParseError?: (message: string) => void,
): string {
  const defaultPath = path.join(projectDirectory, DEFAULT_PACKAGES_INSTALL_DIR);
  const dbtProjectFile = path.join(projectDirectory, DBT_PROJECT_FILE);
  if (!existsSync(dbtProjectFile)) {
    return defaultPath;
  }
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(dbtProjectFile, "utf8"));
  } catch (error) {
    onParseError?.(error instanceof Error ? error.message : String(error));
    return defaultPath;
  }
  const configuredPath =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)["packages-install-path"]
      : undefined;
  if (typeof configuredPath === "string" && configuredPath.length > 0) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(projectDirectory, configuredPath);
  }
  return defaultPath;
}

/**
 * Reduce a path to a form the prefix test below can compare. A packages path
 * reaches us from dbt, from a `dbt_project.yml`, or from a VS Code URI, so it
 * may carry a trailing separator, use a different separator than the candidate
 * it is compared against, or — on Windows — disagree on drive-letter case
 * (`C:\…` from the Python bridge vs `c:\…` from a URI) while naming the very
 * same directory.
 *
 * Case is folded on win32 only. Windows filesystems are case-insensitive, so
 * folding there resolves a genuine ambiguity; on Linux `DBT_PACKAGES` really is
 * a different directory from `dbt_packages`, and folding would silently exclude
 * a real project.
 */
function normalizeForCompare(value: string): string {
  const normalized = value.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  if (!parentPath || !candidatePath) {
    return false;
  }
  const candidate = normalizeForCompare(candidatePath);
  const parent = normalizeForCompare(parentPath);
  if (!parent) {
    return false;
  }
  if (candidate === parent) {
    return true;
  }
  // Match on a separator boundary so `/w/dbt_packages_old` is not treated as
  // living inside `/w/dbt_packages`.
  return candidate.startsWith(`${parent}/`);
}

/**
 * True when `candidatePath` sits inside an installed-packages or virtualenv
 * directory, and so must not be registered as a standalone dbt project.
 *
 * The `EXCLUDED_PROJECT_DIRS` segment check runs first and needs no I/O, which
 * covers the default layout on the hot path. `packagesInstallPaths` is only
 * consulted for projects that configure `packages-install-path` outside that
 * list; pass already-resolved paths (see `resolvePackagesInstallPath`) so this
 * stays free of hidden file reads.
 *
 * Separator-agnostic: a Windows or UNC path is classified correctly regardless
 * of the host platform.
 */
export function isInsidePackagesPath(
  candidatePath: string,
  packagesInstallPaths: string[] = [],
): boolean {
  const segments = candidatePath.split(/[\\/]/);
  if (segments.some((segment) => EXCLUDED_PROJECT_DIRS.includes(segment))) {
    return true;
  }
  return packagesInstallPaths.some((packagesInstallPath) =>
    isPathInside(candidatePath, packagesInstallPath),
  );
}

export function hashProjectRoot(projectRoot: string) {
  return crypto.createHash("md5").update(projectRoot).digest("hex");
}

export interface DBTCommandExecutionStrategy {
  execute(
    command: DBTCommand,
    signal?: AbortSignal,
  ): Promise<CommandProcessResult>;
}

export class CLIDBTCommandExecutionStrategy implements DBTCommandExecutionStrategy {
  constructor(
    protected commandProcessExecutionFactory: CommandProcessExecutionFactory,
    protected processEnvironment: FusionProcessEnvironment,
    protected terminal: DBTTerminal,
    protected cwd: string,
    protected dbtPath: string,
  ) {}

  async execute(
    command: DBTCommand,
    signal?: AbortSignal,
  ): Promise<CommandProcessResult> {
    const commandExecution = this.executeCommand(command, signal);
    const executionPromise = command.logToTerminal
      ? (await commandExecution).completeWithTerminalOutput()
      : (await commandExecution).complete();
    return executionPromise;
  }

  protected async executeCommand(
    command: DBTCommand,
    signal?: AbortSignal,
  ): Promise<CommandProcessExecution> {
    if (command.logToTerminal && command.focus) {
      await this.terminal.show(true);
    }
    this.terminal.info(
      "dbtCommand",
      "Executed dbt command: " + command.getCommandAsString(),
      true,
      {
        command: command.getCommandAsString(),
        execution: "cli",
      },
    );
    if (command.logToTerminal) {
      this.terminal.log(
        `> Executing task: ${command.getCommandAsString()}\n\r`,
      );
    }
    const { args } = command;
    const combinedSignal = combineAbortSignals(signal, command.signal);

    return this.commandProcessExecutionFactory.createCommandProcessExecution({
      command: this.dbtPath,
      args,
      signal: combinedSignal,
      cwd: this.cwd,
      envVars: this.processEnvironment.getEnvironmentVariables(),
    });
  }
}

export class DBTCommand {
  constructor(
    public statusMessage: string,
    public args: string[],
    public focus: boolean = false,
    public showProgress: boolean = false,
    public logToTerminal: boolean = false,
    public executionStrategy?: DBTCommandExecutionStrategy,
    public signal?: AbortSignal,
    public downloadArtifacts: boolean = false,
  ) {}

  addArgument(arg: string) {
    this.args.push(arg);
  }

  getCommandAsString() {
    return "dbt " + this.args.join(" ");
  }

  setExecutionStrategy(executionStrategy: DBTCommandExecutionStrategy) {
    this.executionStrategy = executionStrategy;
  }

  execute(signal?: AbortSignal) {
    if (this.executionStrategy === undefined) {
      throw new Error("Execution strategy is required to run dbt commands");
    }
    return this.executionStrategy.execute(this, signal);
  }

  setSignal(signal: AbortSignal) {
    this.signal = signal;
  }
}

export interface ExecuteSQLResult {
  table: {
    column_names: string[];
    column_types: string[];
    rows: unknown[][];
  };
  raw_sql: string;
  compiled_sql: string;
  modelName: string;
}

export class ExecuteSQLError extends Error {
  compiled_sql: string;
  constructor(message: string, compiled_sql: string) {
    super(message);
    this.compiled_sql = compiled_sql;
  }
}

export interface CompilationResult {
  compiled_sql: string;
}

export class QueryExecution {
  constructor(
    private cancelFunc: () => Promise<void>,
    private queryResult: () => Promise<ExecuteSQLResult>,
  ) {}

  cancel(): Promise<void> {
    return this.cancelFunc();
  }

  executeQuery(): Promise<ExecuteSQLResult> {
    return this.queryResult();
  }
}

export interface DBTProjectIntegration {
  dispose(): void;
  // initialize execution infrastructure
  initializeProject(): Promise<void>;
  // called when project configuration is changed
  refreshProjectConfig(): Promise<void>;
  // Change target
  setSelectedTarget(targetName: string): Promise<void>;
  getTargetNames(): Promise<Array<string>>;
  // retrieve dbt configs
  getTargetPath(): string | undefined;
  getModelPaths(): string[] | undefined;
  getSeedPaths(): string[] | undefined;
  getMacroPaths(): string[] | undefined;
  getPackageInstallPath(): string | undefined;
  getAdapterType(): string | undefined;
  getVersion(): number[] | undefined;
  getProjectName(): string;
  getSelectedTarget(): string | undefined;
  // parse manifest
  rebuildManifest(): Promise<void>;
  // execute queries
  executeSQL(
    query: string,
    limit: number,
    modelName: string,
  ): Promise<QueryExecution>;
  // dbt commands
  runModel(command: DBTCommand): Promise<DBTCommand | undefined>;
  buildModel(command: DBTCommand): Promise<DBTCommand | undefined>;
  buildProject(command: DBTCommand): Promise<DBTCommand | undefined>;
  runTest(command: DBTCommand): Promise<DBTCommand | undefined>;
  runModelTest(command: DBTCommand): Promise<DBTCommand | undefined>;
  compileModel(command: DBTCommand): Promise<DBTCommand | undefined>;
  generateDocs(command: DBTCommand): Promise<DBTCommand | undefined>;
  clean(command: DBTCommand): Promise<string>;
  executeCommandImmediately(command: DBTCommand): Promise<CommandProcessResult>;
  deps(command: DBTCommand): Promise<string>;
  debug(command: DBTCommand): Promise<string>;
  // altimate commands
  unsafeCompileNode(modelName: string): Promise<string>;
  unsafeCompileQuery(
    query: string,
    originalModelName: string | undefined,
  ): Promise<string>;
  validateSQLDryRun(query: string): Promise<SqlDryRunResult>;
  getColumnsOfSource(
    sourceName: string,
    tableName: string,
  ): Promise<DBColumn[]>;
  getColumnsOfModel(modelName: string): Promise<DBColumn[]>;
  getCatalog(): Promise<Catalog>;
  getDebounceForRebuildManifest(): number;
  getBulkSchemaFromDB(
    nodes: DBTNode[],
    signal: AbortSignal,
  ): Promise<Record<string, DBColumn[]>>;
  getBulkCompiledSQL(models: NodeMetaData[]): Promise<Record<string, string>>;
  findPackageVersion(packageName: string): string | undefined;
  applyDeferConfig(deferConfig: DeferConfig): Promise<void>;
  applySelectedTarget(): Promise<void>;
  getDiagnostics(): DBTDiagnosticResult;
  // Whether the integration finished initializing its execution state (for
  // dbt-core: the Python-side `project` binding exists on the CURRENT bridge).
  // False after an init failure or mid re-initialization; consumers such as
  // the Altimate scan must skip work that needs the project until it is true.
  isInitialized(): boolean;
  cleanupConnections(): Promise<void>;
}

export class DBTCommandFactory {
  constructor(private configuration: DBTConfiguration) {}

  createVersionCommand(): DBTCommand {
    return new DBTCommand("Detecting dbt version...", ["--version"]);
  }

  createParseCommand(): DBTCommand {
    return new DBTCommand("Parsing dbt project...", ["parse"]);
  }

  createRunModelCommand(params: RunModelParams): DBTCommand {
    const { plusOperatorLeft, modelName, plusOperatorRight } = params;
    const buildModelCommandAdditionalParams =
      this.configuration.getRunModelCommandAdditionalParams();

    return new DBTCommand(
      "Running dbt model...",
      [
        "run",
        "--select",
        `${plusOperatorLeft}${modelName}${plusOperatorRight}`,
        ...buildModelCommandAdditionalParams,
      ],
      true,
      true,
      true,
    );
  }

  createBuildModelCommand(params: RunModelParams): DBTCommand {
    const { plusOperatorLeft, modelName, plusOperatorRight } = params;
    const buildModelCommandAdditionalParams =
      this.configuration.getBuildModelCommandAdditionalParams();

    return new DBTCommand(
      "Building dbt model...",
      [
        "build",
        "--select",
        `${plusOperatorLeft}${modelName}${plusOperatorRight}`,
        ...buildModelCommandAdditionalParams,
      ],
      true,
      true,
      true,
    );
  }

  createBuildProjectCommand(): DBTCommand {
    return new DBTCommand(
      "Building dbt project...",
      ["build"],
      true,
      true,
      true,
    );
  }

  createTestModelCommand(testName: string): DBTCommand {
    const testModelCommandAdditionalParams =
      this.configuration.getTestModelCommandAdditionalParams();

    return new DBTCommand(
      "Testing dbt model...",
      ["test", "--select", testName, ...testModelCommandAdditionalParams],
      true,
      true,
      true,
    );
  }

  createCompileModelCommand(params: RunModelParams): DBTCommand {
    const { plusOperatorLeft, modelName, plusOperatorRight } = params;
    return new DBTCommand(
      "Compiling dbt models...",
      [
        "compile",
        "--select",
        `${plusOperatorLeft}${modelName}${plusOperatorRight}`,
      ],
      true,
      true,
      true,
    );
  }

  createDocsGenerateCommand(): DBTCommand {
    return new DBTCommand(
      "Generating dbt Docs...",
      ["docs", "generate"],
      true,
      true,
      true,
    );
  }

  createCleanCommand(): DBTCommand {
    return new DBTCommand(
      "Cleaning dbt project...",
      ["clean"],
      true,
      true,
      true,
    );
  }

  createInstallDepsCommand(): DBTCommand {
    return new DBTCommand("Installing packages...", ["deps"], true, true, true);
  }

  createAddPackagesCommand(packages: string[]): DBTCommand {
    return new DBTCommand(
      "Installing packages...",
      ["deps", "--add-package", ...packages],
      true,
      true,
      true,
    );
  }

  createDebugCommand(focus: boolean = true): DBTCommand {
    return new DBTCommand("Debugging...", ["debug"], focus, true, true);
  }
}
