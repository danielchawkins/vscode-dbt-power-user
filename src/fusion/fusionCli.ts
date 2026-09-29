import { statSync } from "fs";
import * as path from "path";
import {
  CliCommand,
  compiledOutput,
  deferState,
  jsonLogErrors,
  parseLogEntries,
  PathKind,
  ShowPreview,
  showPreview,
  toCliArgs,
} from "../core/cli";
import { DBT_PROJECT_FILE, ProjectSnapshot } from "../core/project";
import {
  DBTCommand,
  DBTProjectIntegration,
  QueryExecution,
} from "../dbt_integration/dbtIntegration";
import {
  DBTDiagnosticData,
  DBTDiagnosticResult,
} from "../dbt_integration/diagnostics";
import {
  Catalog,
  DBColumn,
  DBTNode,
  NodeMetaData,
  SqlDryRunResult,
} from "../dbt_integration/domain";
import { DBTTerminal } from "../dbt_integration/terminal";
import {
  CommandProcessExecutionFactory,
  CommandProcessResult,
} from "./commandProcessExecution";
import { fusionCatalog } from "./fusionCatalog";

/** The resolved dbt binary and the environment every invocation inherits. */
export interface FusionCliExecutable {
  path: string;
  env: Record<string, string>;
}

export interface FusionCliRunOptions {
  signal?: AbortSignal;
  /** Merged over the executable's environment; wins on conflicts. */
  env?: Record<string, string>;
  /** Streams output to the terminal, first revealing it when `focus` is set. */
  terminalOutput?: { focus: boolean };
}

function diskProbe(target: string): PathKind {
  try {
    const stats = statSync(target);
    return stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "missing";
  } catch {
    return "missing";
  }
}

function anySignal(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length <= 1) {
    return present[0];
  }
  const controller = new AbortController();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort());
    }
  }
  return controller.signal;
}

/** The `--select` value of a factory-built command. */
function selectOf(command: DBTCommand): string {
  const at = command.args.indexOf("--select");
  const select = at < 0 ? undefined : command.args[at + 1];
  if (select === undefined) {
    throw new Error(`No --select in dbt ${command.args.join(" ")}`);
  }
  return select;
}

const IMMEDIATE_KINDS = ["deps", "clean", "debug"] as const;

function immediateKind(command: DBTCommand): CliCommand {
  const kind = IMMEDIATE_KINDS.find(
    (k) => command.args.length === 1 && command.args[0] === k,
  );
  if (kind === undefined) {
    throw new Error(`Unsupported command: dbt ${command.args.join(" ")}`);
  }
  return { kind };
}

const REBUILD_RANGE = {
  startLine: 0,
  startColumn: 0,
  endLine: 999,
  endColumn: 999,
};

const columnsQuery = (relation: string) =>
  `{% set output = [] %}{% for result in adapter.get_columns_in_relation(${relation}) %} ` +
  `{% do output.append({"column": result.name, "dtype": result.dtype}) %} {% endfor %} {{ tojson(output) }}`;

function bulkSchemaQuery(nodes: DBTNode[]): string {
  return `
{% set result = {} %}
{% for n in ${JSON.stringify(nodes)} %}
  {% set columns = adapter.get_columns_in_relation(ref(n["name"])) %}
  {% set new_columns = [] %}
  {% for column in columns %}
    {% do new_columns.append({"column": column.name, "dtype": column.dtype}) %}
  {% endfor %}
  {% do result.update({n["unique_id"]:new_columns}) %}
{% endfor %}
{% for n in graph.sources.values() %}
  {% set columns = adapter.get_columns_in_relation(source(n["source_name"], n["identifier"])) %}
  {% set new_columns = [] %}
  {% for column in columns %}
    {% do new_columns.append({"column": column.name, "dtype": column.dtype}) %}
  {% endfor %}
  {% do result.update({n["unique_id"]:new_columns}) %}
{% endfor %}
{{ tojson(result) }}`
    .trim()
    .split("\n")
    .join("");
}

/** Runs dbt Fusion commands for one project, reading the snapshot afresh on every call. */
export class FusionCli implements DBTProjectIntegration {
  private readonly warnedDeferPaths = new Set<string>();
  private rebuildManifestDiagnostics: DBTDiagnosticData[] = [];
  private rebuildAbort: AbortController | undefined;

  constructor(
    private readonly executable: FusionCliExecutable,
    private readonly snapshot: () => ProjectSnapshot,
    private readonly processes: CommandProcessExecutionFactory,
    private readonly terminal: DBTTerminal,
  ) {}

  /**
   * Runs `command` in the project root. Warns once per defer state path that is neither a directory nor a
   * `manifest.json` file. Resolves with the process result whatever the exit code.
   */
  async run(
    command: CliCommand,
    options: FusionCliRunOptions = {},
  ): Promise<CommandProcessResult> {
    const snapshot = this.snapshot();
    this.warnUnusableDefer(snapshot);
    const args = toCliArgs(snapshot, command, diskProbe);
    const execution = this.processes.createCommandProcessExecution({
      command: this.executable.path,
      args,
      cwd: snapshot.root,
      signal: options.signal,
      envVars: { ...this.executable.env, ...options.env },
    });
    if (!options.terminalOutput) {
      return execution.complete();
    }
    if (options.terminalOutput.focus) {
      await this.terminal.show(true);
    }
    this.terminal.log(`> Executing task: dbt ${args.join(" ")}\n\r`);
    return execution.completeWithTerminalOutput();
  }

  /**
   * The compiled SQL of an inline query. Throws the `error`/`fatal` records of stderr when there are any; only then
   * reads the compile record from stdout.
   */
  async compileInline(
    sql: string,
    options?: FusionCliRunOptions,
  ): Promise<string> {
    const { stdout, stderr } = await this.run(
      { kind: "compileInline", sql, output: "json" },
      options,
    );
    throwLogErrors(stderr);
    return compiledOutput(stdout);
  }

  /** Preview rows of an inline query. Throws stderr errors first, as `compileInline` does. */
  async show(
    sql: string,
    limit: number,
    options?: FusionCliRunOptions,
  ): Promise<ShowPreview> {
    const { stdout, stderr } = await this.run(
      { kind: "show", sql, limit },
      options,
    );
    throwLogErrors(stderr);
    return showPreview(stdout);
  }

  // -------- project state, read from the snapshot --------

  dispose(): void {
    this.rebuildAbort?.abort();
    this.rebuildAbort = undefined;
  }

  async initializeProject(): Promise<void> {}

  /** The snapshot is read on every call, so there is nothing to refresh. */
  async refreshProjectConfig(): Promise<void> {}

  async setSelectedTarget(_targetName: string): Promise<void> {
    throw new Error("The target comes from fusionPowerUser.target");
  }

  async getTargetNames(): Promise<string[]> {
    return [];
  }

  getSelectedTarget(): string | undefined {
    return this.snapshot().invocation.target;
  }

  getTargetPath(): string {
    return this.snapshot().paths.targetPath;
  }

  getModelPaths(): string[] {
    return this.snapshot().paths.modelPaths;
  }

  getSeedPaths(): string[] {
    return this.snapshot().paths.seedPaths;
  }

  getMacroPaths(): string[] {
    return this.snapshot().paths.macroPaths;
  }

  getPackageInstallPath(): string {
    return this.snapshot().paths.packagesInstallPath;
  }

  getAdapterType(): string {
    return "unknown";
  }

  getVersion(): number[] {
    return [0, 0, 0];
  }

  getProjectName(): string {
    return this.snapshot().name;
  }

  getDebounceForRebuildManifest(): number {
    return 500;
  }

  getDiagnostics(): DBTDiagnosticResult {
    return {
      rebuildManifestDiagnostics: this.rebuildManifestDiagnostics,
      projectConfigDiagnostics: [],
    };
  }

  findPackageVersion(_packageName: string): string | undefined {
    return undefined;
  }

  /** Defer comes from the snapshot on every run. */
  async applyDeferConfig(): Promise<void> {}

  async applySelectedTarget(): Promise<void> {}

  isInitialized(): boolean {
    return true;
  }

  async cleanupConnections(): Promise<void> {}

  // -------- parse --------

  /**
   * Parses the project, aborting a parse still in flight. The `error`/`fatal` then `warn` stderr records become
   * diagnostics on the project file; a failure to run becomes one `command-execution` diagnostic.
   */
  async rebuildManifest(): Promise<void> {
    this.rebuildAbort?.abort();
    const controller = new AbortController();
    this.rebuildAbort = controller;
    const filePath = path.join(this.snapshot().root, DBT_PROJECT_FILE);
    try {
      const { stderr } = await this.run(
        { kind: "parse" },
        { signal: controller.signal },
      );
      if (stderr) {
        this.terminal.error(
          "dbtFusionParseProjectUserError",
          "Could not parse project user error",
          new Error(stderr),
          true,
          { error: stderr },
        );
      }
      this.rebuildManifestDiagnostics = parseLogEntries(stderr).map(
        ({ level, message }) => ({
          filePath,
          message,
          severity: level,
          range: REBUILD_RANGE,
          source: "dbt-fusion",
          category: "manifest-rebuild",
        }),
      );
    } catch (error) {
      this.terminal.error(
        "dbtFusionCannotParseProjectCommandExecuteError",
        "Could not parse project command execution error",
        error,
        true,
      );
      this.rebuildManifestDiagnostics = [
        {
          filePath,
          message: "Unable to parse dbt fusion cli response: " + error,
          severity: "error",
          range: REBUILD_RANGE,
          source: "dbt-fusion",
          category: "command-execution",
        },
      ];
    }
  }

  // -------- queued commands --------

  async runModel(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "run", select: selectOf(command) });
  }

  async buildModel(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "build", select: selectOf(command) });
  }

  async buildProject(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "build" });
  }

  async runTest(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "test", select: selectOf(command) });
  }

  async runModelTest(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "test", select: selectOf(command) });
  }

  async compileModel(command: DBTCommand): Promise<DBTCommand> {
    return this.queued(command, { kind: "compile", select: selectOf(command) });
  }

  async generateDocs(_command: DBTCommand): Promise<DBTCommand | undefined> {
    throw new Error("dbt fusion does not support docs generation");
  }

  /** Runs `deps`, `clean` or `debug` now; any other command throws. */
  async executeCommandImmediately(
    command: DBTCommand,
  ): Promise<CommandProcessResult> {
    return this.execute(command, immediateKind(command), command.signal);
  }

  async clean(_command: DBTCommand): Promise<string> {
    throw new Error("Use executeCommandImmediately");
  }

  async deps(_command: DBTCommand): Promise<string> {
    throw new Error("Use executeCommandImmediately");
  }

  async debug(_command: DBTCommand): Promise<string> {
    throw new Error("Use executeCommandImmediately");
  }

  // -------- queries --------

  async executeSQL(
    query: string,
    limit: number,
    modelName: string,
  ): Promise<QueryExecution> {
    const controller = new AbortController();
    return new QueryExecution(
      async () => controller.abort(),
      async () => {
        const preview = await this.show(query, limit, {
          signal: controller.signal,
        });
        return {
          table: {
            column_names: preview.columns,
            column_types: preview.columns.map(() => "string"),
            rows: preview.rows,
          },
          compiled_sql: preview.compiledSql,
          raw_sql: query,
          modelName,
        };
      },
    );
  }

  /** The compiled SQL of one model; its record wins over the tests compiled with it. */
  async unsafeCompileNode(modelName: string): Promise<string> {
    const { stdout, stderr } = await this.run({
      kind: "compileNode",
      node: modelName,
    });
    throwLogErrors(stderr);
    return compiledOutput(stdout, "model");
  }

  async unsafeCompileQuery(
    query: string,
    _originalModelName: string | undefined,
  ): Promise<string> {
    return this.compileInline(query);
  }

  async validateSQLDryRun(_query: string): Promise<SqlDryRunResult> {
    throw new Error("validateSQLDryRun is not supported");
  }

  /** Throws the raw stderr when there is any. */
  async getColumnsOfSource(
    sourceName: string,
    tableName: string,
  ): Promise<DBColumn[]> {
    const { stdout, stderr } = await this.run({
      kind: "compileInline",
      sql: columnsQuery(`source('${sourceName}', '${tableName}')`),
      output: "quiet",
    });
    if (stderr) {
      throw new Error(stderr);
    }
    return JSON.parse(stdout.trim()) as DBColumn[];
  }

  async getColumnsOfModel(modelName: string): Promise<DBColumn[]> {
    return JSON.parse(
      await this.compileInline(columnsQuery(`ref('${modelName}')`)),
    ) as DBColumn[];
  }

  /** Columns of `nodes` and of every source, keyed by unique id. */
  async getBulkSchemaFromDB(
    nodes: DBTNode[],
    signal: AbortSignal,
  ): Promise<Record<string, DBColumn[]>> {
    if (nodes.length === 0) {
      return {};
    }
    return JSON.parse(
      await this.compileInline(bulkSchemaQuery(nodes), { signal }),
    ) as Record<string, DBColumn[]>;
  }

  /** Compiled SQL per unique id; a model that fails to compile is logged and left out. */
  async getBulkCompiledSQL(
    models: NodeMetaData[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const node of models) {
      try {
        result[node.unique_id] = await this.unsafeCompileNode(node.name);
      } catch (e) {
        this.terminal.error(
          "getBulkCompiledSQL",
          `Unable to compile sql for model ${node.unique_id}`,
          e,
          true,
        );
      }
    }
    return result;
  }

  async getCatalog(): Promise<Catalog> {
    return fusionCatalog(
      this.getTargetPath(),
      (sql) => this.compileInline(sql),
      this.terminal,
    );
  }

  /** Gives `command` this project's argv for display and an execution strategy that runs `cli`. */
  private queued(command: DBTCommand, cli: CliCommand): DBTCommand {
    command.args = toCliArgs(this.snapshot(), cli, diskProbe);
    command.setExecutionStrategy({
      execute: (c, signal) => this.execute(c, cli, signal),
    });
    return command;
  }

  private execute(
    command: DBTCommand,
    cli: CliCommand,
    signal: AbortSignal | undefined,
  ): Promise<CommandProcessResult> {
    const commandLine = `dbt ${toCliArgs(this.snapshot(), cli, diskProbe).join(" ")}`;
    this.terminal.info(
      "dbtCommand",
      "Executed dbt command: " + commandLine,
      true,
      {
        command: commandLine,
        execution: "cli",
      },
    );
    return this.run(cli, {
      signal: anySignal(signal, command.signal),
      env: command.env,
      terminalOutput: command.logToTerminal
        ? { focus: command.focus }
        : undefined,
    });
  }

  private warnUnusableDefer(snapshot: ProjectSnapshot): void {
    const state = deferState(snapshot.invocation.defer, diskProbe);
    if (
      state.kind !== "unusable" ||
      this.warnedDeferPaths.has(state.manifestPath)
    ) {
      return;
    }
    this.warnedDeferPaths.add(state.manifestPath);
    this.terminal.warn(
      "FusionCliUnusableDeferState",
      `Defer state path ${state.manifestPath} is neither a directory nor a manifest.json file; running without --state`,
    );
  }
}

function throwLogErrors(stderr: string): void {
  const errors = jsonLogErrors(stderr);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
