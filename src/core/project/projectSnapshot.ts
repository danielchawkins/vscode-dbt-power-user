import * as path from "path";
import { DbtProjectFile, declaredProjectName } from "./dbtProjectFile";
import { ProjectPaths, resolveProjectPaths } from "./projectPaths";

/** `project` passes no `--static-analysis`, so the project's own `+static_analysis` model config applies. */
export type StaticAnalysisMode = "project" | "off" | "baseline" | "strict";

export const DEFAULT_STATIC_ANALYSIS_MODE: StaticAnalysisMode = "project";

const STATIC_ANALYSIS_MODES = [
  "project",
  "off",
  "baseline",
  "strict",
] as const satisfies readonly StaticAnalysisMode[];

export function parseStaticAnalysisMode(raw: unknown): StaticAnalysisMode {
  return (
    STATIC_ANALYSIS_MODES.find((mode) => mode === raw) ??
    DEFAULT_STATIC_ANALYSIS_MODE
  );
}

/**
 * Where the language server writes compiled SQL. `separate`: `target/.lsp/`, so editing never overwrites what a
 * CLI run wrote. `shared`: the CLI's own `target/`, one copy per model. Fusion's only control is
 * `DBT_LSP_USE_TARGET_LSP`; `dbt lsp --target-path` does not move this output (evidence experiment l8).
 */
const LSP_COMPILED_OUTPUTS = ["separate", "shared"] as const;
type LspCompiledOutput = (typeof LSP_COMPILED_OUTPUTS)[number];
const DEFAULT_LSP_COMPILED_OUTPUT: LspCompiledOutput = "separate";

function parseLspCompiledOutput(raw: unknown): LspCompiledOutput | undefined {
  const value = typeof raw === "string" ? raw.trim() : raw;
  return LSP_COMPILED_OUTPUTS.find((mode) => mode === value);
}

/** The environment override wins over the setting; either is ignored when invalid. */
function resolveLspCompiledOutput(
  override: unknown,
  setting: unknown,
): LspCompiledOutput {
  return (
    parseLspCompiledOutput(override) ??
    parseLspCompiledOutput(setting) ??
    DEFAULT_LSP_COMPILED_OUTPUT
  );
}

export const TRACE_SERVER_LEVELS = ["off", "messages", "verbose"] as const;
export type TraceServerLevel = (typeof TRACE_SERVER_LEVELS)[number];

export function parseTraceServerLevel(raw: unknown): TraceServerLevel {
  return TRACE_SERVER_LEVELS.find((level) => level === raw) ?? "off";
}

/** One project's entry in `fusionPowerUser.defer.perProject`, keyed by project-relative path. */
export interface DeferSettingsEntry {
  deferToProduction: boolean;
  favorState: boolean;
  manifestPathForDeferral?: string;
}

/** The setting values one snapshot reads, as the settings module returns them for the project root. */
export interface ProjectSnapshotSettings {
  dbtPath: string | undefined;
  target: string | undefined;
  profilesDir: string | undefined;
  staticAnalysis: unknown;
  lspCompiledOutput: unknown;
  lintEnabled: boolean | undefined;
  traceServer: unknown;
  deferPerProject: Readonly<Record<string, DeferSettingsEntry>> | undefined;
  runParams: readonly string[];
  buildParams: readonly string[];
  testParams: readonly string[];
}

/** Everything the resolver reads, each captured once per revision. */
export interface ProjectSnapshotInputs {
  /** Absolute project root. */
  root: string;
  /** Absolute workspace-folder root, when the project is inside one. */
  folder: string | undefined;
  /** The first open workspace folder; `${workspaceFolder}` in command params resolves against it. */
  firstWorkspaceFolder: string | undefined;
  userHome: string;
  /** The extension host's environment, inherited by every dbt process. */
  environment: Readonly<Record<string, string>>;
  /** The `lspCompiledOutput` environment override, which wins over the setting. */
  lspCompiledOutputOverride: string | undefined;
  settings: ProjectSnapshotSettings;
  projectFile: DbtProjectFile;
}

export type ProjectExecutable =
  /** `path` is absolute. */
  | { source: "configured"; path: string }
  /** A variable or a folder-relative path could not be resolved; `path` is as far as it got. */
  | { source: "unresolvable"; path: string }
  | { source: "path" };

export interface ResolvedDefer {
  deferToProduction: boolean;
  favorState: boolean;
  /** Absolute path of the state manifest; unset or empty when the entry names none. */
  manifestPath: string | undefined;
}

interface ProjectInvocation {
  executable: ProjectExecutable;
  /** Unset selects dbt's default target from `profiles.yml`. */
  target: string | undefined;
  /** Absolute; unset lets dbt search its default locations. */
  profilesDir: string | undefined;
  staticAnalysis: StaticAnalysisMode;
  compiledOutput: { mode: LspCompiledOutput; dir: string };
  /** Language-server-only launch options. */
  lsp: { lintEnabled: boolean; traceServer: TraceServerLevel };
  defer: ResolvedDefer | undefined;
  environment: Readonly<Record<string, string>>;
  commandParams: {
    run: readonly string[];
    build: readonly string[];
    test: readonly string[];
  };
}

/** Everything the extension knows about one Declared Project at one revision. */
export interface ProjectSnapshot {
  root: string;
  folder: string | undefined;
  /** The project file's `name`, or the root directory's name. */
  name: string;
  paths: ProjectPaths;
  invocation: ProjectInvocation;
}

/** What `${…}` placeholders in a setting resolve against. */
export interface VariableScope {
  /** `${workspaceFolder}`; unset leaves the placeholder in place. */
  folder: string | undefined;
  userHome: string;
  lookup: (name: string) => string | undefined;
}

/**
 * Expands `${env:NAME}`, `${userHome}` and, when `folder` is known, `${workspaceFolder}`. Unresolved placeholders
 * stay in the result; replacements are literal, so `$1` in a value is not a backreference.
 */
export function substituteVariables(
  value: string,
  scope: VariableScope,
): string {
  let result = value.replace(
    /\$\{env:(.*?)\}/g,
    (match, name: string) => scope.lookup(name) ?? match,
  );
  result = result.replace(/\$\{userHome\}/g, () => scope.userHome);
  const folder = scope.folder;
  if (folder !== undefined) {
    result = result.replace(/\$\{workspaceFolder\}/g, () => folder);
  }
  return result;
}

/** Absolute path for a folder-relative setting, or undefined when it is empty or cannot be resolved. */
function resolveFolderPath(
  raw: string | undefined,
  scope: VariableScope,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const substituted = substituteVariables(trimmed, scope);
  if (substituted.includes("${workspaceFolder}")) {
    return undefined;
  }
  if (path.isAbsolute(substituted)) {
    return path.resolve(substituted);
  }
  return scope.folder !== undefined
    ? path.resolve(scope.folder, substituted)
    : undefined;
}

/** The `dbtPath` setting resolved against the project's folder; empty selects PATH lookup. */
export function resolveExecutable(
  raw: string | undefined,
  scope: VariableScope,
): ProjectExecutable {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { source: "path" };
  }
  const substituted = substituteVariables(trimmed, scope);
  if (substituted.includes("${workspaceFolder}")) {
    return { source: "unresolvable", path: substituted };
  }
  if (path.isAbsolute(substituted)) {
    return { source: "configured", path: path.resolve(substituted) };
  }
  if (scope.folder !== undefined) {
    return {
      source: "configured",
      path: path.resolve(scope.folder, substituted),
    };
  }
  return { source: "unresolvable", path: substituted };
}

/** The `defer.perProject` key for a project: its path relative to its workspace folder. */
export function deferSettingsKey(
  root: string,
  folder: string | undefined,
): string {
  return path.relative(folder ?? "", root);
}

/**
 * Resolves one `defer.perProject` entry. The manifest path resolves against the project root, which is also what
 * `${workspaceFolder}` means in it; an empty path is kept as given.
 */
function resolveDefer(
  entry: DeferSettingsEntry | undefined,
  root: string,
  scope: Omit<VariableScope, "folder">,
): ResolvedDefer | undefined {
  if (!entry) {
    return undefined;
  }
  const manifest = entry.manifestPathForDeferral;
  return {
    deferToProduction: entry.deferToProduction,
    favorState: entry.favorState,
    manifestPath: manifest
      ? path.resolve(
          root,
          substituteVariables(manifest, { ...scope, folder: root }),
        )
      : manifest,
  };
}

/** Builds one project's snapshot. Pure: equal inputs give equal snapshots. */
export function resolveProjectSnapshot(
  inputs: ProjectSnapshotInputs,
): ProjectSnapshot {
  const { root, folder, settings } = inputs;
  const lookup = (name: string) => inputs.environment[name];
  const folderScope = { folder, userHome: inputs.userHome, lookup };
  const paramsScope = {
    folder: inputs.firstWorkspaceFolder,
    userHome: inputs.userHome,
    lookup,
  };
  const substituteParam = (value: string) =>
    substituteVariables(value, paramsScope);
  const paths = resolveProjectPaths(root, inputs.projectFile.config);
  const compiledOutput = resolveLspCompiledOutput(
    inputs.lspCompiledOutputOverride,
    settings.lspCompiledOutput,
  );
  return {
    root,
    folder,
    name: declaredProjectName(inputs.projectFile.config) ?? path.basename(root),
    paths,
    invocation: {
      executable: resolveExecutable(settings.dbtPath, folderScope),
      target: settings.target?.trim() || undefined,
      profilesDir: resolveFolderPath(settings.profilesDir, folderScope),
      staticAnalysis: parseStaticAnalysisMode(settings.staticAnalysis),
      compiledOutput: {
        mode: compiledOutput,
        dir:
          compiledOutput === "separate"
            ? path.join(paths.targetPath, ".lsp")
            : paths.targetPath,
      },
      lsp: {
        lintEnabled: settings.lintEnabled ?? true,
        traceServer: parseTraceServerLevel(settings.traceServer),
      },
      defer: resolveDefer(
        settings.deferPerProject?.[deferSettingsKey(root, folder)],
        root,
        folderScope,
      ),
      environment: inputs.environment,
      commandParams: {
        run: settings.runParams.map(substituteParam),
        build: settings.buildParams.map(substituteParam),
        test: settings.testParams.map(substituteParam),
      },
    },
  };
}
