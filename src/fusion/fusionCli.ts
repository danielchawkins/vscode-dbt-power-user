import { statSync } from "fs";
import * as path from "path";
import {
  CliCommand,
  compiledOutput,
  DEFERRABLE_KINDS,
  deferState,
  parseLogEntries,
  PathKind,
  ShowPreview,
  showPreview,
  toCliArgs,
  toCliEnvironment,
} from "../core/cli";
import {
  DBT_PROJECT_FILE,
  deferSettingsKey,
  ProjectSnapshot,
} from "../core/project";
import { DBTCommand, QueryExecution } from "../dbt_integration/dbtIntegration";
import {
  DBTDiagnosticData,
  DBTDiagnosticResult,
} from "../dbt_integration/diagnostics";
import { DBColumn } from "../dbt_integration/domain";
import { DBTTerminal } from "../dbt_integration/terminal";
import {
  CommandProcessExecutionFactory,
  CommandProcessResult,
} from "./commandProcessExecution";

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
  const abort = () => {
    for (const signal of present) {
      signal.removeEventListener("abort", abort);
    }
    controller.abort();
  };
  if (present.some((s) => s.aborted)) {
    controller.abort();
    return controller.signal;
  }
  for (const signal of present) {
    signal.addEventListener("abort", abort);
  }
  return controller.signal;
}

/** The command kinds Project queues. */
export type QueuedCliCommand = Extract<
  CliCommand,
  { kind: "run" | "build" | "test" | "compile" }
>;

function queuedStatus(cli: QueuedCliCommand): string {
  switch (cli.kind) {
    case "run":
      return "Running dbt model...";
    case "build":
      return cli.select === undefined
        ? "Building dbt project..."
        : "Building dbt model...";
    case "test":
      return "Testing dbt model...";
    case "compile":
      return "Compiling dbt models...";
  }
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

/**
 * Runs dbt Fusion commands for one project. Every command reads the snapshot afresh; the name and path getters read
 * one cached snapshot that `refreshProjectConfig` replaces.
 */
export class FusionCli {
  private readonly warnedDeferPaths = new Set<string>();
  private config: ProjectSnapshot | undefined;
  private rebuildManifestDiagnostics: DBTDiagnosticData[] = [];
  private rebuildAbort: AbortController | undefined;

  constructor(
    private readonly executable: FusionCliExecutable,
    private readonly snapshot: () => ProjectSnapshot,
    private readonly processes: CommandProcessExecutionFactory,
    private readonly terminal: DBTTerminal,
  ) {}

  /**
   * Runs `command` in the project root. Warns once when defer is enabled without a state path, and once per
   * state path that is neither a directory nor a `manifest.json` file. Resolves with the process result whatever the exit code.
   */
  async run(
    command: CliCommand,
    options: FusionCliRunOptions = {},
  ): Promise<CommandProcessResult> {
    const snapshot = this.snapshot();
    if (DEFERRABLE_KINDS.includes(command.kind)) {
      this.warnUnusableDefer(snapshot);
    }
    const args = toCliArgs(snapshot, command, diskProbe);
    const commandLine = `dbt ${args.join(" ")}`;
    this.terminal.info(
      "dbtCommand",
      `Executed dbt command: ${commandLine}`,
      true,
      {
        command: commandLine,
        execution: "cli",
      },
    );
    const execution = this.processes.createCommandProcessExecution({
      command: this.executable.path,
      args,
      cwd: snapshot.root,
      signal: options.signal,
      envVars: { ...toCliEnvironment(snapshot), ...options.env },
    });
    if (!options.terminalOutput) {
      return execution.complete();
    }
    if (options.terminalOutput.focus) {
      await this.terminal.show(true);
    }
    this.terminal.log(`> Executing task: dbt ${args.join(" ")}\n\r`);
    const result = await execution.complete({
      onOutput: (chunk) => this.terminal.log(chunk.replace(/\r?\n/g, "\r\n")),
    });
    this.terminal.log("");
    return result;
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
    // With `--log-format json`, Fusion writes a failed query's error record to stdout.
    throwLogErrors(stdout);
    return showPreview(stdout);
  }

  // -------- project state, read from the snapshot --------

  dispose(): void {
    this.rebuildAbort?.abort();
    this.rebuildAbort = undefined;
  }

  /** Rereads the snapshot behind the name and path getters. */
  async refreshProjectConfig(): Promise<void> {
    this.config = this.snapshot();
  }

  private projectConfig(): ProjectSnapshot {
    this.config ??= this.snapshot();
    return this.config;
  }

  getTargetPath(): string {
    return this.projectConfig().paths.targetPath;
  }

  getModelPaths(): string[] {
    return this.projectConfig().paths.modelPaths;
  }

  getSeedPaths(): string[] {
    return this.projectConfig().paths.seedPaths;
  }

  getMacroPaths(): string[] {
    return this.projectConfig().paths.macroPaths;
  }

  getPackageInstallPath(): string {
    return this.projectConfig().paths.packagesInstallPath;
  }

  getProjectName(): string {
    return this.projectConfig().name;
  }

  getDiagnostics(): DBTDiagnosticResult {
    return {
      rebuildManifestDiagnostics: this.rebuildManifestDiagnostics,
      projectConfigDiagnostics: [],
    };
  }

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

  // -------- queued commands --------

  /**
   * A command for the project queue, with this project's argv for display and an execution strategy that runs `cli`.
   * The argv is computed again when the command runs, so it can differ from the argv shown when it was queued.
   */
  prepare(cli: QueuedCliCommand): DBTCommand {
    const command = new DBTCommand(
      queuedStatus(cli),
      toCliArgs(this.snapshot(), cli, diskProbe),
      true,
      true,
      true,
    );
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
    return this.run(cli, {
      signal: anySignal(signal, command.signal),
      terminalOutput: command.logToTerminal
        ? { focus: command.focus }
        : undefined,
    });
  }

  private warnUnusableDefer(snapshot: ProjectSnapshot): void {
    const state = deferState(snapshot.invocation.defer, diskProbe);
    if (state.kind === "unset" && !this.warnedDeferPaths.has("")) {
      this.warnedDeferPaths.add("");
      this.terminal.warn(
        "deferMissingManifestPath",
        `fusionPowerUser.defer.perProject has deferToProduction enabled for ` +
          `${deferSettingsKey(snapshot.root, snapshot.folder)} but no manifestPathForDeferral; ` +
          `running without --state.`,
        false,
      );
      return;
    }
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

/** Throws the `error`/`fatal` messages of JSON stderr records; lines that are not JSON are ignored. */
function throwLogErrors(stderr: string): void {
  const errors = parseLogEntries(stderr)
    .filter((entry) => entry.level === "error")
    .map((entry) => entry.message);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
