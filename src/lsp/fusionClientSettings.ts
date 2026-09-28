import { homedir } from "os";
import * as path from "path";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import { DBT_PATH_SETTING } from "../fusion/fusionExecutable";
import { STATIC_ANALYSIS_MODE_SETTING } from "../fusion/staticAnalysisMode";
import { readEnvironmentOverride, readSetting, SettingKey } from "../settings";
import { resolveSettingsVariables } from "../utils";

export const PROFILES_DIR_SETTING = "profilesDir";
export const TARGET_SETTING = "target";
export const LINT_ENABLED_SETTING = "lint.enabled";
export const TRACE_SERVER_SETTING = "trace.server";
export const LSP_COMPILED_OUTPUT_SETTING = "lsp.compiledOutput";

const DEFAULT_TRACE_SERVER = "off";

export const TRACE_SERVER_LEVELS = ["off", "messages", "verbose"] as const;
export type FusionTraceServerLevel = (typeof TRACE_SERVER_LEVELS)[number];

/**
 * Where the language server writes compiled SQL. `separate`: `target/.lsp/`, so editing never overwrites what a
 * CLI run wrote. `shared`: the CLI's own `target/`, one copy per model. Fusion's only control is
 * `DBT_LSP_USE_TARGET_LSP`; `dbt lsp --target-path` does not move this output (evidence experiment l8).
 */
export const LSP_COMPILED_OUTPUTS = ["separate", "shared"] as const;
export type LspCompiledOutput = (typeof LSP_COMPILED_OUTPUTS)[number];
const DEFAULT_LSP_COMPILED_OUTPUT: LspCompiledOutput = "separate";

/** Settings whose change restarts a project's language server. */
export const FUSION_LAUNCH_SETTINGS: readonly SettingKey[] = [
  DBT_PATH_SETTING,
  STATIC_ANALYSIS_MODE_SETTING,
  PROFILES_DIR_SETTING,
  TARGET_SETTING,
  LINT_ENABLED_SETTING,
  TRACE_SERVER_SETTING,
  LSP_COMPILED_OUTPUT_SETTING,
];

export interface FusionLaunchSettings {
  readonly profilesDir: string | undefined;
  readonly target: string | undefined;
  readonly lintEnabled: boolean;
  readonly traceServer: FusionTraceServerLevel;
  readonly lspCompiledOutput: LspCompiledOutput;
}

function resolveOptionalPath(
  raw: string | undefined,
  folder: WorkspaceFolder | undefined,
  userHome: string,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  const substituted = resolveSettingsVariables(
    trimmed,
    folder?.uri ?? null,
    userHome,
  );
  if (substituted.includes("${workspaceFolder}")) {
    return undefined;
  }

  if (path.isAbsolute(substituted)) {
    return path.resolve(substituted);
  }
  if (folder) {
    return path.resolve(folder.uri.fsPath, substituted);
  }
  return undefined;
}

export function resolveFusionLaunchSettings(
  scope: Uri,
  deps: {
    getWorkspaceFolder?: (scope: Uri) => WorkspaceFolder | undefined;
    getUserHome?: () => string;
  } = {},
): FusionLaunchSettings {
  const getWorkspaceFolder =
    deps.getWorkspaceFolder ?? ((uri) => workspace.getWorkspaceFolder(uri));
  const getUserHome = deps.getUserHome ?? homedir;
  const folder = getWorkspaceFolder(scope);

  const profilesDir = resolveOptionalPath(
    readSetting(PROFILES_DIR_SETTING, scope),
    folder,
    getUserHome(),
  );
  const target = readSetting(TARGET_SETTING, scope)?.trim() || undefined;
  const lintEnabled = readSetting(LINT_ENABLED_SETTING, scope);
  const traceServer = parseTraceServerLevel(
    readSetting(TRACE_SERVER_SETTING, scope),
  );
  const lspCompiledOutput =
    parseLspCompiledOutput(readEnvironmentOverride("lspCompiledOutput")) ??
    parseLspCompiledOutput(readSetting(LSP_COMPILED_OUTPUT_SETTING, scope)) ??
    DEFAULT_LSP_COMPILED_OUTPUT;

  return { profilesDir, target, lintEnabled, traceServer, lspCompiledOutput };
}

export function parseLspCompiledOutput(
  raw: unknown,
): LspCompiledOutput | undefined {
  const value = typeof raw === "string" ? raw.trim() : raw;
  return LSP_COMPILED_OUTPUTS.find((mode) => mode === value);
}

/** The environment that selects `mode` for `dbt lsp`. */
export function lspCompiledOutputEnv(
  mode: LspCompiledOutput,
): Record<string, string> {
  return mode === "separate" ? { DBT_LSP_USE_TARGET_LSP: "1" } : {};
}

export function parseTraceServerLevel(raw: unknown): FusionTraceServerLevel {
  return (
    TRACE_SERVER_LEVELS.find((level) => level === raw) ?? DEFAULT_TRACE_SERVER
  );
}

/** Fusion server process `--log-level`; omit for off. */
export function fusionLogLevelArgument(
  level: FusionTraceServerLevel,
): string | undefined {
  if (level === "messages") {
    return "debug";
  }
  if (level === "verbose") {
    return "trace";
  }
  return undefined;
}
