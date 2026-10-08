import {
  ProjectExecutable,
  ProjectSnapshot,
  StaticAnalysisMode,
  TraceServerLevel,
} from "../project";

/** Selects `target/.lsp/` for compiled output; see `LspCompiledOutput`. */
export const DBT_LSP_USE_TARGET_LSP = "DBT_LSP_USE_TARGET_LSP";

/** Everything a project's `dbt lsp` process is started with; equal launches need no restart. */
export interface LspLaunch {
  executable: ProjectExecutable;
  /** The snapshot root; the client resolves its realpath at spawn. */
  projectDir: string;
  target: string | undefined;
  profile: string | undefined;
  profilesDir: string | undefined;
  staticAnalysis: StaticAnalysisMode;
  lintEnabled: boolean;
  logLevel: "debug" | "trace" | undefined;
  /** The snapshot environment with `DBT_LSP_USE_TARGET_LSP` set to `"1"` (separate) or removed (shared). */
  environment: Readonly<Record<string, string>>;
}

/** Values known only once the client is spawning. */
export interface LspRun {
  port: number;
  commandPrefix: string;
  /** The realpath of `LspLaunch.projectDir`. */
  projectDir: string;
}

function logLevelFor(level: TraceServerLevel): LspLaunch["logLevel"] {
  if (level === "messages") {
    return "debug";
  }
  return level === "verbose" ? "trace" : undefined;
}

export function toLspLaunch(snapshot: ProjectSnapshot): LspLaunch {
  const { invocation } = snapshot;
  const { [DBT_LSP_USE_TARGET_LSP]: _inherited, ...environment } =
    invocation.environment;
  return {
    executable: invocation.executable,
    projectDir: snapshot.root,
    target: invocation.target,
    profile: invocation.profile,
    profilesDir: invocation.profilesDir,
    staticAnalysis: invocation.staticAnalysis,
    lintEnabled: invocation.lsp.lintEnabled,
    logLevel: logLevelFor(invocation.lsp.traceServer),
    environment:
      invocation.compiledOutput.mode === "separate"
        ? { ...environment, [DBT_LSP_USE_TARGET_LSP]: "1" }
        : environment,
  };
}

/** The argv after the executable. `project` static analysis passes no flag, so project config applies. */
export function toLspArgs(launch: LspLaunch, run: LspRun): string[] {
  return [
    "lsp",
    "--socket",
    String(run.port),
    "--project-dir",
    run.projectDir,
    "--lint-enabled",
    launch.lintEnabled ? "true" : "false",
    ...(launch.staticAnalysis === "project"
      ? []
      : ["--static-analysis", launch.staticAnalysis]),
    "--no-version-check",
    "--command-prefix",
    run.commandPrefix,
    ...(launch.profilesDir ? ["--profiles-dir", launch.profilesDir] : []),
    ...(launch.profile ? ["--profile", launch.profile] : []),
    ...(launch.target ? ["--target", launch.target] : []),
    ...(launch.logLevel ? ["--log-level", launch.logLevel] : []),
  ];
}

function sameExecutable(a: ProjectExecutable, b: ProjectExecutable): boolean {
  if (a.source === "path" || b.source === "path") {
    return a.source === b.source;
  }
  return a.source === b.source && a.path === b.path;
}

function sameEnvironment(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => key in b && a[key] === b[key])
  );
}

export function sameLspLaunch(a: LspLaunch, b: LspLaunch): boolean {
  return (
    sameExecutable(a.executable, b.executable) &&
    a.projectDir === b.projectDir &&
    a.target === b.target &&
    a.profile === b.profile &&
    a.profilesDir === b.profilesDir &&
    a.staticAnalysis === b.staticAnalysis &&
    a.lintEnabled === b.lintEnabled &&
    a.logLevel === b.logLevel &&
    sameEnvironment(a.environment, b.environment)
  );
}
