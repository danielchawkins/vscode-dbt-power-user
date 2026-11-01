import * as path from "node:path";
import type { ProjectSnapshot, ResolvedDefer } from "../snapshot";

/** One dbt invocation. Selections and SQL are single argv elements, never split. */
export type CliCommand =
  /** `select` already carries any `+` graph operators; without it, the whole project. */
  | { kind: "run"; select?: string; fullRefresh?: boolean }
  /** Without `select`, the whole project and none of the build params. */
  | { kind: "build"; select?: string; fullRefresh?: boolean }
  | { kind: "test"; select?: string }
  /** The queued model compile. */
  | { kind: "compile"; select?: string }
  /** `defer: "off"` passes `--no-defer` whatever the snapshot's defer says. */
  | {
      kind: "compileInline";
      sql: string;
      output: "json" | "quiet";
      defer?: "off";
    }
  | { kind: "show"; sql: string; limit: number }
  /** `skipVersionCheck` passes `--no-version-check`, so the parse makes no network request for a version. */
  | { kind: "parse"; skipVersionCheck?: boolean }
  | { kind: "deps" }
  /** Lists the unique IDs `select` picks, as JSON lines on stdout; read with `lsUniqueIds`. */
  | { kind: "ls"; select: string }
  | { kind: "clean" }
  | { kind: "debug" };

/**
 * The command kinds that take defer flags: dbt's deferrable commands that the extension runs. `parse` is left out
 * because the manifest it writes describes this project, which every panel reads.
 */
export const DEFERRABLE_KINDS: readonly CliCommand["kind"][] = [
  "run",
  "build",
  "test",
  "compile",
  "compileInline",
  "show",
];

const JSON_LOGS = ["--output", "json", "--log-format", "json"];
const DEBUG_JSON_LOGS = [...JSON_LOGS, "--log-level", "debug"];

/** The configured additional params `command` carries. */
export function commandParamsFor(
  snapshot: ProjectSnapshot,
  command: CliCommand,
): readonly string[] {
  const params = snapshot.invocation.commandParams;
  switch (command.kind) {
    case "run":
      return params.run;
    case "test":
      return params.test;
    case "build":
      return command.select === undefined ? [] : params.build;
    case "compile":
    case "compileInline":
    case "show":
    case "parse":
    case "deps":
    case "ls":
    case "clean":
    case "debug":
      return [];
  }
}

type ShowCommand = Extract<CliCommand, { kind: "show" }>;

const selectArgs = (select: string | undefined) =>
  select === undefined ? [] : ["--select", select];

function showBody({ sql, limit }: ShowCommand): string[] {
  return [
    "show",
    "--log-level",
    "debug",
    "--inline",
    sql,
    "--limit",
    String(limit),
    ...JSON_LOGS,
  ];
}

/** `--full-refresh` when `command` asks for it and `params` do not already carry it. */
export function fullRefreshArgs(
  command: CliCommand,
  params: readonly string[],
): string[] {
  const wanted =
    (command.kind === "run" || command.kind === "build") &&
    command.fullRefresh === true;
  return wanted && !params.includes("--full-refresh") ? ["--full-refresh"] : [];
}

/** Subcommand, selection or payload, and the kind's fixed flags; `params` are the command's `commandParams`. */
function body(command: CliCommand, params: readonly string[]): string[] {
  switch (command.kind) {
    case "run":
    case "build":
      return [
        command.kind,
        ...selectArgs(command.select),
        ...fullRefreshArgs(command, params),
      ];
    case "test":
    case "compile":
      return [command.kind, ...selectArgs(command.select)];
    case "compileInline":
      return [
        "compile",
        "--inline",
        command.sql,
        ...(command.output === "json" ? DEBUG_JSON_LOGS : ["--quiet"]),
      ];
    case "show":
      return showBody(command);
    case "parse":
      return [
        "parse",
        "--log-format",
        "json",
        ...(command.skipVersionCheck ? ["--no-version-check"] : []),
      ];
    case "ls":
      return [
        "ls",
        "--select",
        command.select,
        "--output",
        "json",
        "--output-keys",
        "unique_id",
      ];
    case "deps":
    case "clean":
    case "debug":
      return [command.kind];
  }
}

/** What a path names on disk; `missing` also covers anything that is neither a file nor a directory. */
export type PathKind = "directory" | "file" | "missing";

/** Reads the kind of one path; the only I/O argument construction needs. */
export type PathProbe = (path: string) => PathKind;

/** The defer flags a snapshot asks for, after checking the state path. */
export type DeferState =
  /** No entry for the project: no flags, so dbt's own default (`DBT_DEFER`, `DBT_STATE`, else off) applies. */
  | { kind: "default" }
  /** The entry turns deferral off: `--no-defer`, which also overrides `DBT_DEFER`. */
  | { kind: "off" }
  /** Enabled without a manifest path: dbt's own defer default applies. */
  | { kind: "unset" }
  | { kind: "on"; stateDirectory: string; favorState: boolean }
  /** Enabled with a path that is neither a directory nor a `manifest.json` file; the caller warns. */
  | { kind: "unusable"; manifestPath: string };

const MANIFEST_FILE = "manifest.json";

/** Checks the defer setting against the disk: a directory is the state; a `manifest.json` file names its directory. */
export function deferState(
  defer: ResolvedDefer | undefined,
  probe: PathProbe,
): DeferState {
  if (!defer) {
    return { kind: "default" };
  }
  if (!defer.deferToProduction) {
    return { kind: "off" };
  }
  const { manifestPath, favorState } = defer;
  if (!manifestPath) {
    return { kind: "unset" };
  }
  const found = probe(manifestPath);
  if (found === "directory") {
    return { kind: "on", stateDirectory: manifestPath, favorState };
  }
  if (found === "file" && path.basename(manifestPath) === MANIFEST_FILE) {
    return {
      kind: "on",
      stateDirectory: path.dirname(manifestPath),
      favorState,
    };
  }
  return { kind: "unusable", manifestPath };
}

/** The defer flags of a deferrable command; an inline compile with `defer: "off"` skips the snapshot's state. */
function deferFlags(
  command: CliCommand,
  defer: ResolvedDefer | undefined,
  probe: PathProbe,
): string[] {
  if (!DEFERRABLE_KINDS.includes(command.kind)) {
    return [];
  }
  if (command.kind === "compileInline" && command.defer === "off") {
    return ["--no-defer"];
  }
  return deferArgs(deferState(defer, probe));
}

function deferArgs(state: DeferState): string[] {
  switch (state.kind) {
    case "off":
      return ["--no-defer"];
    case "on":
      return [
        "--defer",
        "--state",
        state.stateDirectory,
        ...(state.favorState ? ["--favor-state"] : []),
      ];
    case "default":
    case "unset":
    case "unusable":
      return [];
  }
}

/**
 * Whether `params` already set a flag as `--name value`, `--name=value` or, given an alias, `-t value`/`-tvalue`.
 * @internal
 */
export function carriesFlag(
  params: readonly string[],
  name: string,
  alias?: string,
): boolean {
  return params.some(
    (param) =>
      param === name ||
      param.startsWith(`${name}=`) ||
      (alias !== undefined && param.startsWith(alias)),
  );
}

/** The environment every CLI invocation for the snapshot inherits. */
export function toCliEnvironment(
  snapshot: ProjectSnapshot,
): Readonly<Record<string, string>> {
  return snapshot.invocation.environment;
}

/**
 * The argv after the executable for one command against one snapshot. Order: the kind's body, its `commandParams`,
 * then `--profiles-dir`, `--project-dir`, `--profile` and `--target` unless the `commandParams` carry them, then defer flags on
 * deferrable kinds. `probe` is read only to check an enabled defer state path.
 */
export function toCliArgs(
  snapshot: ProjectSnapshot,
  command: CliCommand,
  probe: PathProbe,
): string[] {
  const { invocation } = snapshot;
  const params = commandParamsFor(snapshot, command);
  const flag = (name: string, value: string | undefined, alias?: string) =>
    value === undefined || carriesFlag(params, name, alias)
      ? []
      : [name, value];
  return [
    ...body(command, params),
    ...params,
    ...flag("--profiles-dir", invocation.profilesDir),
    ...flag("--project-dir", snapshot.root),
    ...flag("--profile", invocation.profile),
    ...flag("--target", invocation.target, "-t"),
    ...deferFlags(command, invocation.defer, probe),
  ];
}
