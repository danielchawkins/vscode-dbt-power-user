import { homedir } from "os";
import * as path from "path";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import { FUSION_PATH_SETTING } from "../fusion/fusionExecutable";
import { STATIC_ANALYSIS_MODE_SETTING } from "../fusion/staticAnalysisMode";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";
import { resolveSettingsVariables } from "../utils";

export const PROFILES_DIR_SETTING = "profilesDir";
export const TARGET_SETTING = "target";
export const LINT_ENABLED_SETTING = "lintEnabled";

const DEFAULT_LINT_ENABLED = true;

const LAUNCH_SETTING_KEYS = [
  FUSION_PATH_SETTING,
  STATIC_ANALYSIS_MODE_SETTING,
  PROFILES_DIR_SETTING,
  TARGET_SETTING,
  LINT_ENABLED_SETTING,
] as const;

export interface FusionLaunchSettings {
  readonly profilesDir: string | undefined;
  readonly target: string | undefined;
  readonly lintEnabled: boolean;
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
  const config = workspace.getConfiguration(CONFIGURATION_SECTION, scope);

  const profilesDir = resolveOptionalPath(
    config.get<string>(PROFILES_DIR_SETTING),
    folder,
    getUserHome(),
  );
  const target = config.get<string>(TARGET_SETTING)?.trim() || undefined;
  const lintEnabled =
    config.get<boolean>(LINT_ENABLED_SETTING) ?? DEFAULT_LINT_ENABLED;

  return { profilesDir, target, lintEnabled };
}

export function affectsFusionLaunchConfiguration(
  event: ConfigurationChangeEvent,
  scope: Uri,
): boolean {
  return LAUNCH_SETTING_KEYS.some((key) =>
    event.affectsConfiguration(`${CONFIGURATION_SECTION}.${key}`, scope),
  );
}
