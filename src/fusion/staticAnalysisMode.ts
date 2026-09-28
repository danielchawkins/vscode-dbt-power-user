import { Uri } from "vscode";
import { parseStaticAnalysisMode, StaticAnalysisMode } from "../core/project";
import { readSetting } from "../settings";

export const STATIC_ANALYSIS_MODE_SETTING = "staticAnalysis";

export function resolveConfiguredStaticAnalysisMode(
  scope: Uri,
): StaticAnalysisMode {
  return parseStaticAnalysisMode(
    readSetting(STATIC_ANALYSIS_MODE_SETTING, scope),
  );
}

/** `--static-analysis` value for the language server, or undefined to defer to project config. */
export function staticAnalysisLaunchArgument(
  mode: StaticAnalysisMode,
): Exclude<StaticAnalysisMode, "project"> | undefined {
  return mode === "project" ? undefined : mode;
}
