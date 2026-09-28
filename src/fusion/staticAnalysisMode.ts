import { Uri } from "vscode";
import { readSetting } from "../settings";

/** `project` passes no `--static-analysis`, so the project's own `+static_analysis` model config applies. */
export type StaticAnalysisMode = "project" | "off" | "baseline" | "strict";

export const STATIC_ANALYSIS_MODE_SETTING = "staticAnalysis";

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
