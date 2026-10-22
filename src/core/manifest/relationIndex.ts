import type { NodeMetaMap, SourceMetaMap } from "./types";

/** One node that claims a model name, with what picks among claimants. */
interface NameClaimant {
  unique_id: string;
  package_name: string;
  /** The node is the latest version of a versioned model. */
  isLatestVersion: boolean;
}

/** Lookups from a model name, relation name or source table to its unique_id, built once per parse. */
export interface RelationIndex {
  byBaseName: Map<string, string>;
  /** Every node claiming each model name, for `resolveBaseName`. */
  claimantsByBaseName: Map<string, NameClaimant[]>;
  byRelationName: Map<string, string>;
  bySourceKey: Map<string, string>;
  /** Table-level unique_ids by `source_name.table`, for `meta.relationships`. */
  bySourceTable: Map<string, string>;
  /** `source_name.table` keys that more than one source table claims. */
  ambiguousSourceTables: Set<string>;
}

/**
 * The unique_id a model name refers to from `fromPackage`. Among the nodes claiming the name, the declaring package's
 * own nodes win; then the latest version of a versioned model. Otherwise the name is ambiguous and resolves to
 * nothing.
 */
export function resolveBaseName(
  index: RelationIndex,
  name: string,
  fromPackage: string,
): string | undefined {
  let pool = index.claimantsByBaseName.get(name) ?? [];
  const own = pool.filter((c) => c.package_name === fromPackage);
  if (own.length > 0) {
    pool = own;
  }
  if (pool.length > 1) {
    const latest = pool.filter((c) => c.isLatestVersion);
    if (latest.length === 1) {
      pool = latest;
    }
  }
  return pool.length === 1 ? pool[0]?.unique_id : undefined;
}

/** A name-to-unique_id map and the names more than one unique_id claims. */
interface Claims {
  ids: Map<string, string>;
  ambiguous: Set<string>;
}

/** Records `value` under `key`; a different value already under it marks the key ambiguous. */
function claim(claims: Claims, key: string, value: string): void {
  const claimed = claims.ids.get(key);
  if (claimed !== undefined && claimed !== value) {
    claims.ambiguous.add(key);
  }
  claims.ids.set(key, value);
}

/** Builds the node and source lookups the relationship phases resolve against. */
export function buildRelationIndex(
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap?: SourceMetaMap,
): RelationIndex {
  const sourceTables: Claims = { ids: new Map(), ambiguous: new Set() };
  const index: RelationIndex = {
    byBaseName: new Map<string, string>(),
    claimantsByBaseName: new Map<string, NameClaimant[]>(),
    byRelationName: new Map<string, string>(),
    bySourceKey: new Map<string, string>(),
    bySourceTable: sourceTables.ids,
    ambiguousSourceTables: sourceTables.ambiguous,
  };
  for (const node of nodeMetaMap.nodes()) {
    index.byBaseName.set(node.name, node.unique_id);
    const claimants = index.claimantsByBaseName.get(node.name) ?? [];
    claimants.push({
      unique_id: node.unique_id,
      package_name: node.package_name,
      isLatestVersion:
        node.version !== null &&
        node.version !== undefined &&
        node.latest_version !== null &&
        node.latest_version !== undefined &&
        String(node.version) === String(node.latest_version),
    });
    index.claimantsByBaseName.set(node.name, claimants);
    if (node.relation_name) {
      index.byRelationName.set(node.relation_name, node.unique_id);
      index.byRelationName.set(
        node.relation_name.toLowerCase(),
        node.unique_id,
      );
    }
  }
  for (const source of sourceMetaMap?.values() ?? []) {
    for (const tbl of source.tables ?? []) {
      const key = `${source.name}.${tbl.name}`;
      index.bySourceKey.set(key, source.unique_id);
      claim(sourceTables, key, tbl.unique_id);
    }
  }
  return index;
}
