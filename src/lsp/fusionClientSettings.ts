import { homedir } from "os";
import * as path from "path";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import { DBT_PATH_SETTING } from "../fusion/fusionExecutable";
import { STATIC_ANALYSIS_MODE_SETTING } from "../fusion/staticAnalysisMode";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";
import { resolveSettingsVariables } from "../utils";

export const PROFILES_DIR_SETTING = "profilesDir";
export const TARGET_SETTING = "target";
export const LINT_ENABLED_SETTING = "lint.enabled";
export const TRACE_SERVER_SETTING = "trace.server";
export const LSP_COMPILED_OUTPUT_SETTING = "lsp.compiledOutput";
/** Overrides `fusionPowerUser.lsp.compiledOutput` for every project in the extension host's environment. */
export const LSP_COMPILED_OUTPUT_ENV = "FUSION_POWER_USER_LSP_COMPILED_OUTPUT";

const DEFAULT_LINT_ENABLED = true;
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

const LAUNCH_SETTING_KEYS = [
  DBT_PATH_SETTING,
  STATIC_ANALYSIS_MODE_SETTING,
  PROFILES_DIR_SETTING,
  TARGET_SETTING,
  LINT_ENABLED_SETTING,
  TRACE_SERVER_SETTING,
  LSP_COMPILED_OUTPUT_SETTING,
] as const;

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
    env?: NodeJS.ProcessEnv;
  } = {},
): FusionLaunchSettings {
  const getWorkspaceFolder =
    deps.getWorkspaceFolder ?? ((uri) => workspace.getWorkspaceFolder(uri));
  const getUserHome = deps.getUserHome ?? homedir;
  const folder = getWorkspaceFolder(scope);
  const config = workspace.getConfiguration(CONFIGURATION_SECTION, scope);

  const profilesDir = resolveOptionalPath(
    config.get<string>(PROFILES_DIR_SETTING),
    folder,
    getUserHome(),
  );
  const target = config.get<string>(TARGET_SETTING)?.trim() || undefined;
  const lintEnabled =
    config.get<boolean>(LINT_ENABLED_SETTING) ?? DEFAULT_LINT_ENABLED;
  const traceServer = parseTraceServerLevel(
    config.get<unknown>(TRACE_SERVER_SETTING),
  );
  const lspCompiledOutput =
    parseLspCompiledOutput(
      (deps.env ?? process.env)[LSP_COMPILED_OUTPUT_ENV],
    ) ??
    parseLspCompiledOutput(config.get<unknown>(LSP_COMPILED_OUTPUT_SETTING)) ??
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

export function affectsFusionLaunchConfiguration(
  event: ConfigurationChangeEvent,
  scope: Uri,
): boolean {
  return LAUNCH_SETTING_KEYS.some((key) =>
    event.affectsConfiguration(`${CONFIGURATION_SECTION}.${key}`, scope),
  );
}

export function affectsFusionExecutablePath(
  event: ConfigurationChangeEvent,
  scope: Uri,
): boolean {
  return event.affectsConfiguration(
    `${CONFIGURATION_SECTION}.${DBT_PATH_SETTING}`,
    scope,
  );
}
