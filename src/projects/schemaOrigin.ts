import { SourceMetaMap } from "../core/manifest/types";
import {
  DBT_PROJECT_FILE,
  DbtProjectConfig,
  declaredProjectName,
  readDbtProjectFile,
  StaticAnalysisMode,
} from "../core/project";

/** The documented hook (ADR 0006): the extension sets this variable in the language server's environment. */
const SCHEMA_ORIGIN_ENV = "FUSION_POWER_USER_SCHEMA_ORIGIN";
export const SCHEMA_ORIGIN_HOOK = `{{ env_var('${SCHEMA_ORIGIN_ENV}', 'remote') }}`;

/**
 * The schema-origin variable for the language server: `local` for a project known to be warehouse-free, `remote`
 * otherwise. Always set, so the extension host's environment never decides the origin.
 * @internal
 */
export function schemaOriginEnv(
  status: SchemaOriginStatus,
): Record<string, string> {
  return { [SCHEMA_ORIGIN_ENV]: status.kind === "local" ? "local" : "remote" };
}

/** The parts of a project `schemaOriginLaunchEnv` reads. */
export interface SchemaOriginProject {
  readonly manifest: unknown;
  schemaOriginStatus(): SchemaOriginStatus;
}

/**
 * The schema-origin environment a project's language server launches with. Source types are unknown until the
 * project's first parse, so it is `remote` until then; the manifest event re-resolves it.
 */
export function schemaOriginLaunchEnv(
  project: SchemaOriginProject | undefined,
): Record<string, string> {
  return schemaOriginEnv(
    project?.manifest
      ? project.schemaOriginStatus()
      : { kind: "untypedSources", missing: [] },
  );
}

interface UntypedSource {
  source: string;
  table: string;
  /** Absent when the table declares no columns at all. */
  column?: string;
}

export type SchemaOriginStatus =
  /** Hook present and every source column has a `data_type`. */
  | { kind: "local" }
  | { kind: "noHook" }
  | { kind: "untypedSources"; missing: UntypedSource[] };

/**
 * Whether this project can run strict analysis without the warehouse. Evidence README section 7: that needs
 * local origin for sources and a `data_type` on every source column; model types are not used, so models
 * are not checked. Sources from Dependency Projects count, because the root `sources:` config is not yet
 * shown to exclude them.
 */
function resolveSchemaOrigin(input: {
  projectConfig: DbtProjectConfig;
  sources: SourceMetaMap;
}): SchemaOriginStatus {
  if (!hasSchemaOriginHook(input.projectConfig)) {
    return { kind: "noHook" };
  }
  const missing: UntypedSource[] = [];
  for (const source of input.sources.values()) {
    for (const table of source.tables) {
      const columns = Object.values(table.columns ?? {});
      if (columns.length === 0) {
        missing.push({ source: source.name, table: table.name });
        continue;
      }
      for (const column of columns) {
        if (!column.data_type?.trim()) {
          missing.push({
            source: source.name,
            table: table.name,
            column: column.name,
          });
        }
      }
    }
  }
  return missing.length > 0
    ? { kind: "untypedSources", missing }
    : { kind: "local" };
}

/**
 * True when `sources: +schema_origin` in the project file reads the extension's variable.
 * @internal
 */
export function hasSchemaOriginHook(config: DbtProjectConfig): boolean {
  const value = child(config.sources, "+schema_origin");
  return typeof value === "string" && value.includes(SCHEMA_ORIGIN_ENV);
}

/** True when `models: <project name>: +static_analysis` is `strict`, the project-level opt-in. */
function hasProjectStrictAnalysis(config: DbtProjectConfig): boolean {
  const name = declaredProjectName(config);
  return (
    name !== undefined &&
    child(child(config.models, name), "+static_analysis") === "strict"
  );
}

/**
 * The mode Fusion runs a project in: the setting unless it is `project`, which passes no `--static-analysis` flag,
 * so the project file decides — strict with the `+static_analysis: strict` opt-in, else Fusion's baseline default.
 */
export function effectiveStaticAnalysis(
  setting: StaticAnalysisMode,
  projectStrict: boolean,
): Exclude<StaticAnalysisMode, "project"> {
  if (setting !== "project") {
    return setting;
  }
  return projectStrict ? "strict" : "baseline";
}

/** The command that sets `fusionPowerUser.staticAnalysis` to `strict` for a project root. */
export const USE_STRICT_ANALYSIS_COMMAND = "fusionPowerUser.useStrictAnalysis";

/** The workspace folder that holds a project, and how many Declared Projects it declares. */
export interface FolderScope {
  name: string;
  projects: number;
}

/** The folder scope of `project` among `declared`, whose folder-scoped settings it shares. */
export function folderScopeOf(
  declared: readonly { folder: { uri: { fsPath: string }; name: string } }[],
  project: { folder: { uri: { fsPath: string }; name: string } },
): FolderScope {
  return {
    name: project.folder.name,
    projects: declared.filter(
      (other) => other.folder.uri.fsPath === project.folder.uri.fsPath,
    ).length,
  };
}

/** What the strict command changes: the folder setting, which every project in a multi-project folder shares. */
function strictScopeNote(folder: FolderScope | undefined): string {
  return folder && folder.projects > 1
    ? `This sets fusionPowerUser.staticAnalysis for the folder ${folder.name}, ` +
        `which applies to its ${folder.projects} projects.`
    : "";
}

/**
 * Which input keeps a project out of strict: an explicit setting that overrides the project, or `project` with
 * no strict opt-in in the project file. Callers use it only when the effective mode is not strict. A folder with
 * several projects adds what the fix changes.
 */
export function whyNotStrict(
  setting: StaticAnalysisMode,
  folder?: FolderScope,
): string {
  const why =
    setting === "project"
      ? `fusionPowerUser.staticAnalysis is "project" and ${DBT_PROJECT_FILE} has no +static_analysis: strict, ` +
        "so Fusion's default (baseline) applies."
      : `fusionPowerUser.staticAnalysis is "${setting}", which overrides the project.`;
  return [why, strictScopeNote(folder)].filter(Boolean).join(" ");
}

function child(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The schema-origin status of the project at `root`, from its project file and the sources of `manifest`. */
export function projectSchemaOrigin(
  root: string,
  manifest: { sourceMetaMap: SourceMetaMap } | undefined,
): SchemaOriginStatus {
  return resolveSchemaOrigin({
    projectConfig: readDbtProjectFile(root).config,
    sources: manifest?.sourceMetaMap ?? new Map(),
  });
}

/** The column-lineage opt-ins the project at `root` has made in its own project file. */
export function projectOptIns(
  root: string,
  manifest: { sourceMetaMap: SourceMetaMap } | undefined,
): { strict: boolean; schemaOrigin: SchemaOriginStatus } {
  return {
    strict: hasProjectStrictAnalysis(readDbtProjectFile(root).config),
    schemaOrigin: projectSchemaOrigin(root, manifest),
  };
}
