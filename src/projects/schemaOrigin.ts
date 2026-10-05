import { DbtProjectConfig, declaredProjectName } from "../core/project";
import { SourceMetaMap } from "../dbt_integration/domain";

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
export function resolveSchemaOrigin(input: {
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
export function hasProjectStrictAnalysis(config: DbtProjectConfig): boolean {
  const name = declaredProjectName(config);
  return (
    name !== undefined &&
    child(child(config.models, name), "+static_analysis") === "strict"
  );
}

function child(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
