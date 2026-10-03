import { statSync } from "fs";
import * as path from "path";
import {
  CliCommand,
  compiledOutput,
  DEFERRABLE_KINDS,
  deferState,
  firstLogLine,
  isConfigError,
  logLocation,
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
  /** Receives each stdout and stderr chunk in arrival order. */
  onOutput?: (chunk: string) => void;
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
  { kind: "run" | "build" | "test" | "compile" | "deps" }
>;

function queuedStatus(cli: QueuedCliCommand): string {
  switch (cli.kind) {
    case "run":
      return cli.select === undefined
        ? "Running dbt project..."
        : "Running dbt model...";
    case "build":
      return cli.select === undefined
        ? "Building dbt project..."
        : "Building dbt model...";
    case "test":
      return cli.select === undefined
        ? "Testing dbt project..."
        : "Testing dbt model...";
    case "compile":
      return "Compiling dbt models...";
    case "deps":
      return "Installing dbt packages...";
  }
}

const REBUILD_RANGE = {
  startLine: 0,
  startColumn: 0,
  endLine: 0,
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
    return execution.complete({ onOutput: options.onOutput });
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
   * Parses the project, aborting a parse still in flight. The `error`/`fatal` then `warn` log records that concern
   * the project as a whole (see `isConfigError`) become diagnostics, at the file Fusion names or on line 1 of the
   * project file; node errors are left to the language server. A non-zero exit with no such record, or a failure to
   * run, becomes one diagnostic on the project file.
   */
  async rebuildManifest(): Promise<void> {
    this.rebuildAbort?.abort();
    const controller = new AbortController();
    this.rebuildAbort = controller;
    const root = this.snapshot().root;
    const filePath = path.join(root, DBT_PROJECT_FILE);
    try {
      const { stdout, stderr, exitCode } = await this.run(
        { kind: "parse" },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        return;
      }
      // With `--log-format json`, Fusion writes its log records, errors included, to stdout.
      const all = parseLogEntries(`${stdout}\n${stderr}`);
      const entries = all.filter((entry) => isConfigError(entry.message));
      if (exitCode && !all.some((entry) => entry.level === "error")) {
        entries.unshift({
          level: "error",
          message:
            firstLogLine(stderr) || `dbt parse exited with code ${exitCode}`,
        });
      }
      this.rebuildManifestDiagnostics = entries.map(({ level, message }) => ({
        ...locate(root, filePath, message),
        message,
        severity: level,
        source: "dbt-fusion",
        category: "manifest-rebuild",
      }));
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
   * Its output streams to the log channel as well as to the caller's `onOutput`.
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
      execute: (c, signal, onOutput) =>
        this.run(cli, {
          signal: anySignal(signal, c.signal),
          onOutput: (chunk) => {
            this.terminal.log(chunk);
            onOutput?.(chunk);
          },
        }),
    });
    return command;
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

/** The file and line Fusion names in `message`, resolved under `root`; line 1 of `fallback` when it names none. */
function locate(
  root: string,
  fallback: string,
  message: string,
): Pick<DBTDiagnosticData, "filePath" | "range"> {
  const location = logLocation(message);
  if (!location) {
    return { filePath: fallback, range: REBUILD_RANGE };
  }
  const line = Math.max(location.line - 1, 0);
  return {
    filePath: path.resolve(root, location.file),
    range: {
      startLine: line,
      startColumn: Math.max(location.column - 1, 0),
      endLine: line,
      endColumn: 999,
    },
  };
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
