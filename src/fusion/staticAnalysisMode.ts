import { ConfigurationChangeEvent, Uri, workspace } from "vscode";
import { CONFIGURATION_SECTION } from "../projects/projectConfiguration";

export type StaticAnalysisMode = "off" | "baseline" | "strict";

export interface StaticAnalysisSelection {
  /** Resource-scoped setting value, or the product default when unset. */
  readonly configured: StaticAnalysisMode;
  /** What the server is actually running, once a client has reported. */
  readonly effective: StaticAnalysisMode | "unknown";
}

export type FusionCapability =
  | "columnLineage"
  | "columnDefinition"
  | "typeDiagnostics"
  | "selectStarHover"
  | "columnRename";

export const STATIC_ANALYSIS_MODE_SETTING = "staticAnalysis";

export const DEFAULT_STATIC_ANALYSIS_MODE: StaticAnalysisMode = "baseline";

const STATIC_ANALYSIS_MODES = [
  "off",
  "baseline",
  "strict",
] as const satisfies readonly StaticAnalysisMode[];

const STRICT_CAPABILITIES: readonly FusionCapability[] = [
  "columnLineage",
  "columnDefinition",
  "typeDiagnostics",
  "selectStarHover",
  "columnRename",
];

export function capabilitiesFor(
  mode: StaticAnalysisMode,
): ReadonlySet<FusionCapability> {
  if (mode === "strict") {
    return new Set(STRICT_CAPABILITIES);
  }
  return new Set();
}

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

export function createStaticAnalysisSelection(
  configured: StaticAnalysisMode,
): StaticAnalysisSelection {
  return { configured, effective: "unknown" };
}

export function resolveStaticAnalysisSelection(
  scope: Uri,
): StaticAnalysisSelection {
  return createStaticAnalysisSelection(
    resolveConfiguredStaticAnalysisMode(scope),
  );
}

/** Launch flag value derived from the configured mode. */
export function staticAnalysisLaunchArgument(
  selection: StaticAnalysisSelection,
): StaticAnalysisMode {
  return selection.configured;
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

export function selectionAdmitsCapability(
  selection: StaticAnalysisSelection,
  capability: FusionCapability,
): boolean {
  if (selection.effective === "unknown") {
    return false;
  }
  return capabilitiesFor(selection.effective).has(capability);
}
