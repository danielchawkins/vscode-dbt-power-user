import type { Command } from "vscode";
import { LanguageStatusSeverity } from "vscode";
import type { StaticAnalysisMode } from "../../core/snapshot/index";
import { failureSummary } from "../../core/text";
import type { FusionClientState } from "../../fusion/fusionClient";
import {
  effectiveStaticAnalysis,
  type FolderScope,
  type SchemaOriginStatus,
  USE_STRICT_ANALYSIS_COMMAND,
  whyNotStrict,
} from "../registry/schemaOrigin";

/** What a project has opted into in its own project file. */
export interface ProjectOptIns {
  strict: boolean;
  schemaOrigin: SchemaOriginStatus;
}

/** One missing column-lineage opt-in; `command` adds it after that command's own confirmation. */
interface OptInLine {
  text: string;
  command?: Command;
}

/** What the status shows beside a project's client state. */
export interface ProjectNotes {
  /** The current configuration error, in full. */
  error?: string | undefined;
  /** A note on the project's resolved environment. */
  environment?: string | undefined;
}

/** What the client language status item shows for one project. */
interface ClientItemView {
  text: string;
  severity: LanguageStatusSeverity;
  busy: boolean;
  detail: string;
  command: Pick<Command, "title" | "command">;
}

/**
 * The client item for a project: a failure's summary, or else a configuration error, replaces the state's text
 * and turns the item into an error; the environment note follows the detail.
 */
export function clientItemView(input: {
  projectName: string;
  state: FusionClientState;
  failureReason: string | undefined;
  notes: ProjectNotes;
}): ClientItemView {
  const { projectName, state, notes } = input;
  const failure =
    state === "failed" ? failureSummary(input.failureReason) : undefined;
  const error = failure ? undefined : notes.error;
  const problem = failure ?? error;
  const detail = problem ? `${projectName}: ${problem}` : projectName;
  return {
    text: error ? clientText("failed") : clientText(state),
    severity: error ? LanguageStatusSeverity.Error : clientSeverity(state),
    busy: state === "starting" || state === "restarting",
    detail: notes.environment ? `${detail} · ${notes.environment}` : detail,
    command: {
      title: "Show output",
      command: "fusionPowerUser.showFusionOutput",
    },
  };
}

/**
 * The missing column-lineage opt-ins, each with the command that adds it when one exists.
 * `setting` is the configured `fusionPowerUser.staticAnalysis`; it decides whether the project file matters.
 * `folder` names the folder the strict fix changes.
 */
export function optInLines(
  optIns: ProjectOptIns | undefined,
  setting: StaticAnalysisMode,
  folder?: FolderScope,
): OptInLine[] {
  if (!optIns) {
    return [];
  }
  const lines: OptInLine[] = [];
  if (effectiveStaticAnalysis(setting, optIns.strict) !== "strict") {
    lines.push({
      text: whyNotStrict(setting, folder),
      command: {
        title: "Use strict analysis",
        command: USE_STRICT_ANALYSIS_COMMAND,
      },
    });
  }
  const origin = optIns.schemaOrigin;
  switch (origin.kind) {
    case "local":
      break;
    case "noHook":
      lines.push({
        text: "Sources read their schemas from the warehouse.",
        command: {
          title: "Add schema-origin hook",
          command: "fusionPowerUser.addSchemaOriginHook",
        },
      });
      break;
    case "untypedSources":
      lines.push({
        text:
          `${origin.missing.length} source column(s) or table(s) lack a data_type, ` +
          "so strict analysis still needs the warehouse.",
      });
      break;
  }
  return lines;
}

/** The static-analysis status text: the setting, or under `project` the mode the project file selects. */
export function staticText(
  setting: StaticAnalysisMode,
  projectStrict: boolean,
): string {
  const mode = effectiveStaticAnalysis(setting, projectStrict);
  return setting === "project"
    ? `static: ${mode} (project)`
    : `static: ${mode}`;
}

/** @internal */
export function clientText(state: FusionClientState): string {
  switch (state) {
    case "starting":
      return "$(sync~spin) dbt Fusion starting";
    case "restarting":
      return "$(sync~spin) dbt Fusion restarting";
    case "running":
      return "$(check) dbt Fusion";
    case "failed":
      return "$(error) dbt Fusion";
    case "stopped":
      return "$(debug-disconnect) dbt Fusion";
  }
}

/** @internal */
export function clientSeverity(
  state: FusionClientState,
): LanguageStatusSeverity {
  switch (state) {
    case "failed":
      return LanguageStatusSeverity.Error;
    case "stopped":
      return LanguageStatusSeverity.Warning;
    case "starting":
    case "running":
    case "restarting":
      return LanguageStatusSeverity.Information;
  }
}
