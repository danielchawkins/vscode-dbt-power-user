import { statSync } from "fs";
import {
  CliCommand,
  compiledOutput,
  deferState,
  jsonLogErrors,
  PathKind,
  ShowPreview,
  showPreview,
  toCliArgs,
} from "../core/cli";
import { ProjectSnapshot } from "../core/project";
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

/** Runs dbt Fusion commands for one project, reading the snapshot afresh on every call. */
export class FusionCli {
  private readonly warnedDeferPaths = new Set<string>();

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
  run(
    command: CliCommand,
    options: FusionCliRunOptions = {},
  ): Promise<CommandProcessResult> {
    const snapshot = this.snapshot();
    this.warnUnusableDefer(snapshot);
    return this.processes
      .createCommandProcessExecution({
        command: this.executable.path,
        args: toCliArgs(snapshot, command, diskProbe),
        cwd: snapshot.root,
        signal: options.signal,
        envVars: { ...this.executable.env, ...options.env },
      })
      .complete();
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
