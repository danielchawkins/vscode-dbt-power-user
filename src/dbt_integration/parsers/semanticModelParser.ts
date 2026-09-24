import {
  SemanticEntity,
  SemanticEntityType,
  SemanticModelMetaData,
  SemanticModelMetaMap,
} from "../domain";
import { ManifestProject } from "../manifestProject";
import { DBTTerminal } from "../terminal";

const REF_PATTERN =
  /^ref\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)$/;

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
  constructor(private terminal: DBTTerminal) {}

  /**
   * Walks the manifest's `semantic_models` section and produces a map keyed
   * by semantic_model `unique_id`. Each entry captures the anchor model's
   * `unique_id` (resolved via `depends_on.nodes`, falling back to the raw
   * `ref('name')` expression) plus the entity definitions filtered to the
   * four valid `SemanticEntityType`s. Malformed or unrecognized entries are
   * silently skipped — `terminal.debug` records why.
   */
  createSemanticModelMetaMap(
    semanticModels: any,
    project: ManifestProject,
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
        if (!sm || !sm.unique_id) {
          continue;
        }
        const modelRef: string | undefined = sm.model;
        const data: SemanticModelMetaData = {
          unique_id: sm.unique_id,
          name: sm.name,
          package_name: sm.package_name,
          model_ref: modelRef,
          model_unique_id: this.resolveModelUniqueId(
            modelRef,
            sm.depends_on?.nodes,
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
   * pick the first `model.*` unique_id; if absent (rare), parse the
   * `ref('name')` expression and look it up by package + name.
   */
  private resolveModelUniqueId(
    modelRef: string | undefined,
    dependsOnNodes: string[] | undefined,
  ): string | undefined {
    if (Array.isArray(dependsOnNodes)) {
      const modelNode = dependsOnNodes.find((n) => n.startsWith("model."));
      if (modelNode) {
        return modelNode;
      }
    }
    if (!modelRef) {
      return undefined;
    }
    const match = REF_PATTERN.exec(modelRef.trim());
    if (!match) {
      return undefined;
    }
    // Without the package context we can't fully qualify; return the raw
    // ref name and let consumers fall back to bare-name lookup.
    return match[1];
  }

  private parseEntities(entities: any): SemanticEntity[] {
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
    for (const e of entities) {
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
        expr: typeof e.expr === "string" ? e.expr : undefined,
        description: e.description,
        role: e.role,
      });
    }
    return result;
  }
}
