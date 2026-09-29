import * as crypto from "crypto";

import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
  CommandProcessResult,
} from "../fusion/commandProcessExecution";
import { DBTConfiguration } from "./configuration";
import { DBTDiagnosticResult } from "./diagnostics";
import {
  Catalog,
  DBColumn,
  DBTNode,
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
      envVars: {
        ...this.processEnvironment.getEnvironmentVariables(),
        ...command.env,
      },
    });
  }
}

export class DBTCommand {
  /** Variables added to this command's process only, on top of the project's environment. */
  env: Record<string, string> = {};

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
