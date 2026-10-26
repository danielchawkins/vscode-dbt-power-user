import type { Log } from "../log";
import type { ManifestProject } from "./manifestProject";
import { type RelationIndex, resolveTarget } from "./relationIndex";
import type {
  SemanticEntity,
  SemanticEntityType,
  SemanticModelMetaData,
  SemanticModelMetaMap,
  SemanticModelResource,
} from "./types";

interface EntityResource {
  name: string;
  type: string;
  expr?: unknown;
  description?: string;
  role?: string;
}

/**
 * Parses dbt `semantic_models[]` entries from the manifest into a structured
 * map keyed by unique_id. Captures entity definitions so downstream consumers
 * (e.g. the ERD overlay's `RelationshipParser.fromSemanticEntities`) can
 * derive PK/FK relationships from foreign-vs-primary entity pairings.
 *
 * Independent of the existing shallow `MetricParser` — that one keeps
 * `MetricMetaData` minimal because tree-view / lineage code doesn't need
 * entity data. Adding entities here keeps the change isolated.
 */
export class SemanticModelParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  /**
   * Walks the manifest's `semantic_models` section and produces a map keyed
   * by semantic_model `unique_id`. Each entry captures the anchor model's
   * `unique_id`, resolved from `depends_on.nodes`, else from the `model` ref
   * through `index`, else left unset, plus the entity definitions filtered to
   * the four valid `SemanticEntityType`s. Malformed or unrecognized entries are
   * silently skipped; `terminal.debug` records why.
   */
  createSemanticModelMetaMap(
    semanticModels: Record<string, SemanticModelResource> | null | undefined,
    project: ManifestProject,
    index?: RelationIndex,
  ): Promise<SemanticModelMetaMap> {
    return new Promise((resolve) => {
      const projectRoot = project.getProjectRoot();
      const projectName = project.getProjectName();
      this.terminal.debug(
        "SemanticModelParser",
        `Parsing semantic_models for "${projectName}" at ${projectRoot}`,
      );
      const map: SemanticModelMetaMap = new Map();
      if (semanticModels === null || semanticModels === undefined) {
        resolve(map);
        return;
      }

      for (const key in semanticModels) {
        const sm = semanticModels[key];
        if (!sm?.unique_id) {
          continue;
        }
        const modelRef: string | undefined = sm.model;
        const data: SemanticModelMetaData = {
          unique_id: sm.unique_id,
          name: sm.name,
          package_name: sm.package_name,
          model_ref: modelRef,
          model_unique_id: this.resolveModelUniqueId(
            {
              modelRef,
              dependsOnNodes: sm.depends_on?.nodes,
              fromPackage: sm.package_name,
            },
            index,
          ),
          entities: this.parseEntities(sm.entities),
          description: sm.description,
          meta: sm.meta,
          path: sm.original_file_path,
        };
        map.set(data.unique_id, data);
      }
      this.terminal.debug(
        "SemanticModelParser",
        `Parsed ${map.size} semantic_models for "${projectName}"`,
      );
      resolve(map);
    });
  }

  /**
   * The semantic_model's `depends_on.nodes` includes the anchor model. We
   * pick the first `model.*` unique_id; if absent (rare), resolve the `model`
   * ref through `resolveTarget`, from the semantic model's package.
   */
  private resolveModelUniqueId(
    site: {
      modelRef: string | undefined;
      dependsOnNodes: string[] | undefined;
      fromPackage: string;
    },
    index: RelationIndex | undefined,
  ): string | undefined {
    if (Array.isArray(site.dependsOnNodes)) {
      const modelNode = site.dependsOnNodes.find((n) => n.startsWith("model."));
      if (modelNode) {
        return modelNode;
      }
    }
    if (!site.modelRef || !index) {
      return undefined;
    }
    return resolveTarget(site.modelRef, index, site.fromPackage);
  }

  private parseEntities(entities: unknown): SemanticEntity[] {
    if (!Array.isArray(entities)) {
      return [];
    }
    const validTypes: ReadonlySet<SemanticEntityType> = new Set([
      "primary",
      "foreign",
      "unique",
      "natural",
    ]);
    const result: SemanticEntity[] = [];
    for (const e of entities as (EntityResource | null | undefined)[]) {
      if (!e || typeof e.name !== "string") {
        continue;
      }
      const type = e.type as SemanticEntityType;
      if (!validTypes.has(type)) {
        this.terminal.debug(
          "SemanticModelParser",
          `Skipping entity '${e.name}' with unknown type '${e.type}'`,
        );
        continue;
      }
      result.push({
        name: e.name,
        type,
        ...(typeof e.expr === "string" ? { expr: e.expr } : {}),
        ...(e.description === undefined ? {} : { description: e.description }),
        ...(e.role === undefined ? {} : { role: e.role }),
      });
    }
    return result;
  }
}
