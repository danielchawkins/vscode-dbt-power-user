import type { Cardinality, Meta } from "./types";

export const DEFAULT_CARDINALITY: Cardinality = "many-to-one";
const VALID_CARDINALITIES: ReadonlySet<Cardinality> = new Set([
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
]);
/**
 * Soft cardinality override from a `meta.relationship_type` value.
 * Returns `undefined` when meta is absent or carries an unknown value
 * so callers can fall back to detection logic.
 */
export function cardinalityOverrideFromMeta(
  meta: Meta,
): Cardinality | undefined {
  const raw = meta?.relationship_type;
  if (typeof raw === "string" && VALID_CARDINALITIES.has(raw as Cardinality)) {
    return raw as Cardinality;
  }
  return undefined;
}
export function labelFromMeta(meta: Meta): string | undefined {
  const raw = meta?.relationship_label;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
