import { StaticAnalysisMode } from "../../core/project";
import type { FusionClient } from "../../fusion/fusionLanguageClient";
import {
  effectiveStaticAnalysis,
  FolderScope,
  whyNotStrict,
} from "../../projects/schemaOrigin";

/** The effective mode when it computes no column lineage for a running `client`, else `undefined`. */
export function needsStrict(
  client: FusionClient | undefined,
  { strict, folder }: StrictInputs,
): NeedsStrict | undefined {
  if (client?.state !== "running") {
    return undefined;
  }
  const setting = client.staticAnalysis;
  const mode = effectiveStaticAnalysis(setting, strict);
  return mode === "strict" ? undefined : { mode, setting, folder };
}

/** What the Current Project's strict fix depends on. */
export interface StrictInputs {
  /** Whether its `dbt_project.yml` opts into `+static_analysis: strict`. */
  strict: boolean;
  /** The folder the fix changes. */
  folder?: FolderScope | undefined;
}

/** An effective mode that computes no column lineage, with the `fusionPowerUser.staticAnalysis` value behind it. */
export interface NeedsStrict {
  mode: StaticAnalysisMode;
  setting: StaticAnalysisMode;
  /** The folder the fix changes; it matters when the folder declares several projects. */
  folder?: FolderScope | undefined;
}

/** The one fix, as a sentence: the extension setting. */
export const STRICT_FIX = 'Set fusionPowerUser.staticAnalysis to "strict".';

/** Why column lineage needs strict, naming what decided the mode. */
export function strictNeededMessage({
  mode,
  setting,
  folder,
}: NeedsStrict): string {
  return (
    `Column lineage needs strict static analysis, but this project runs ${mode}. ` +
    whyNotStrict(setting, folder)
  );
}
