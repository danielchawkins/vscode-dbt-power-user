import { homedir } from "os";
import { Uri, workspace, WorkspaceFolder } from "vscode";
import {
  LspCompiledOutput,
  parseTraceServerLevel,
  resolveFolderPath,
  resolveLspCompiledOutput,
  TRACE_SERVER_LEVELS,
  TraceServerLevel,
} from "../core/project";
import { DBT_PATH_SETTING } from "../fusion/fusionExecutable";
import { STATIC_ANALYSIS_MODE_SETTING } from "../fusion/staticAnalysisMode";
import {
  readEnvironmentOverride,
  readEnvironmentVariable,
  readSetting,
  SettingKey,
} from "../settings";

export const PROFILES_DIR_SETTING = "profilesDir";
export const TARGET_SETTING = "target";
export const LINT_ENABLED_SETTING = "lint.enabled";
export const TRACE_SERVER_SETTING = "trace.server";
export const LSP_COMPILED_OUTPUT_SETTING = "lsp.compiledOutput";

export { parseTraceServerLevel, TRACE_SERVER_LEVELS };
export type FusionTraceServerLevel = TraceServerLevel;

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
  return resolveFolderPath(raw, {
    folder: folder?.uri.fsPath,
    userHome,
    lookup: readEnvironmentVariable,
  });
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
  const lspCompiledOutput = resolveLspCompiledOutput(
    readEnvironmentOverride("lspCompiledOutput"),
    readSetting(LSP_COMPILED_OUTPUT_SETTING, scope),
  );

  return { profilesDir, target, lintEnabled, traceServer, lspCompiledOutput };
}

/** The environment that selects `mode` for `dbt lsp`. */
export function lspCompiledOutputEnv(
  mode: LspCompiledOutput,
): Record<string, string> {
  return mode === "separate" ? { DBT_LSP_USE_TARGET_LSP: "1" } : {};
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
