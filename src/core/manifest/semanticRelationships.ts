import type { Log } from "../log";
import { DEFAULT_CARDINALITY } from "./relationshipMeta";
import type { SemanticModelMetaData, SemanticModelMetaMap, Ref } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Phase 4 — semantic-layer entity pairings
// ─────────────────────────────────────────────────────────────────────────
type SemanticEntity = SemanticModelMetaData["entities"][number];
interface PrimaryPosting {
  sm_unique_id: string;
  model: string;
  expr: string;
}
interface SemanticContext {
  terminal: Pick<Log, "debug">;
  primaryByName: Map<string, PrimaryPosting>;
}
/**
 * Index primary/unique entities by name. Primary takes precedence over
 * unique on collision.
 */
function indexPrimaryEntities(
  semanticModelMetaMap: SemanticModelMetaMap,
): Map<string, PrimaryPosting> {
  const primaryByName = new Map<string, PrimaryPosting>();
  for (const sm of semanticModelMetaMap.values()) {
    if (!sm.model_unique_id) {
      continue;
    }
    for (const e of sm.entities) {
      if (
        e.type === "primary" ||
        (e.type === "unique" && !primaryByName.has(e.name))
      ) {
        primaryByName.set(e.name, {
          sm_unique_id: sm.unique_id,
          model: sm.model_unique_id,
          expr: e.expr ?? e.name,
        });
      }
    }
  }
  return primaryByName;
}
/**
 * Pair one `foreign` entity with its primary/unique match, if any. The ref
 * runs from the foreign side's anchor model to the primary side's.
 */
function refFromForeignEntity(
  ctx: SemanticContext,
  sm: SemanticModelMetaData,
  entity: SemanticEntity,
): Ref | undefined {
  if (entity.type !== "foreign" || !sm.model_unique_id) {
    return undefined;
  }
  const target = ctx.primaryByName.get(entity.name);
  if (!target) {
    ctx.terminal.debug(
      "RelationshipParser",
      `Skipping foreign entity ${sm.unique_id}.${entity.name}: no primary/unique match`,
    );
    return undefined;
  }
  if (target.sm_unique_id === sm.unique_id) {
    return undefined;
  }
  const fromColumn = entity.expr ?? entity.name;
  return {
    id: `semantic:${sm.unique_id}.${entity.name}->${target.sm_unique_id}`,
    from: { table: sm.model_unique_id, columns: [fromColumn] },
    to: { table: target.model, columns: [target.expr] },
    cardinality: DEFAULT_CARDINALITY,
    source: "semantic",
  };
}
/**
 * Extract refs by pairing `foreign` entities with matching `primary` (or
 * `unique`) entities of the same name across semantic models.
 *
 * If a semantic model lacks a resolved `model_unique_id`, the ref is
 * skipped — we don't fabricate identifiers.
 */
export function refsFromSemanticEntities(
  terminal: Pick<Log, "debug">,
  semanticModelMetaMap: SemanticModelMetaMap | undefined,
): Ref[] {
  if (!semanticModelMetaMap || semanticModelMetaMap.size === 0) {
    return [];
  }
  const ctx: SemanticContext = {
    terminal,
    primaryByName: indexPrimaryEntities(semanticModelMetaMap),
  };
  const refs: Ref[] = [];
  for (const sm of semanticModelMetaMap.values()) {
    for (const e of sm.entities) {
      const ref = refFromForeignEntity(ctx, sm, e);
      if (ref) {
        refs.push(ref);
      }
    }
  }
  terminal.debug(
    "RelationshipParser",
    `Derived ${refs.length} refs from semantic entities`,
  );
  return refs;
}
