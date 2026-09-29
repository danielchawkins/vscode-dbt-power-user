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
