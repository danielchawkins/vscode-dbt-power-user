import { ConfigurationChangeEvent, Uri, workspace } from "vscode";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";

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
  const raw = workspace
    .getConfiguration(CONFIGURATION_SECTION, scope)
    .get<unknown>(STATIC_ANALYSIS_MODE_SETTING);
  return parseStaticAnalysisMode(raw);
}

/** `--static-analysis` value for the language server, or undefined to defer to project config. */
export function staticAnalysisLaunchArgument(
  mode: StaticAnalysisMode,
): Exclude<StaticAnalysisMode, "project"> | undefined {
  return mode === "project" ? undefined : mode;
}

export function affectsStaticAnalysisModeConfiguration(
  event: ConfigurationChangeEvent,
  scope: Uri,
): boolean {
  return event.affectsConfiguration(
    `${CONFIGURATION_SECTION}.${STATIC_ANALYSIS_MODE_SETTING}`,
    scope,
  );
}
