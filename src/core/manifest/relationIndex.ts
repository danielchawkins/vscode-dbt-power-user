import { parseRefExpression } from "./refExpression";
import type { ColumnMetaData, Meta, NodeMetaMap, SourceMetaMap } from "./types";

/** A node or source table, seen as a relation: what the ERD, inference and declared relationships read. */
export interface RelationTable {
  unique_id: string;
  name: string;
  /** Set on a source table to its `source_name`; undefined on a node. */
  source_name?: string | undefined;
  columns: { [columnName: string]: ColumnMetaData };
  meta: Meta;
  /** `config.meta`, which Fusion may place instead of `meta`. */
  configMeta: Meta;
  package_name: string;
}

/** Every node, then every source table, as a {@link RelationTable}. */
export function* relationTables(
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap?: SourceMetaMap,
): Generator<RelationTable> {
  for (const node of nodeMetaMap.nodes()) {
    yield {
      unique_id: node.unique_id,
      name: node.name,
      columns: node.columns ?? {},
      meta: node.meta,
      configMeta: node.config?.meta,
      package_name: node.package_name,
    };
  }
  for (const source of sourceMetaMap?.values() ?? []) {
    for (const tbl of source.tables ?? []) {
      yield {
        unique_id: tbl.unique_id,
        name: tbl.name,
        source_name: source.name,
        columns: tbl.columns ?? {},
        meta: tbl.meta,
        configMeta: tbl.configMeta,
        package_name: source.package_name,
      };
    }
  }
}

/** One node that claims a model name, with what picks among claimants. */
interface NameClaimant {
  unique_id: string;
  package_name: string;
  /** The node's version as a string; undefined for an unversioned node. */
  version: string | undefined;
  /** The node is the latest version of a versioned model. */
  isLatestVersion: boolean;
}

/** Lookups from a model name, relation name or source table to its unique_id, built once per parse. */
export interface RelationIndex {
  /** Every node claiming each model name, for {@link resolveTarget}. */
  claimantsByBaseName: Map<string, NameClaimant[]>;
  /** Relation names as written and without quotes. */
  byRelationName: Map<string, string>;
  /** The keys of `byRelationName`, lowercased. */
  byLowerRelationName: Map<string, string>;
  /** Table-level unique_ids by `source_name.table`, for `source()` targets. */
  bySourceTable: Map<string, string>;
  /** `source_name.table` keys that more than one source table claims. */
  ambiguousSourceTables: Set<string>;
}

/**
 * The unique_id a `to` field names, read from `fromPackage`. A `ref()` resolves through the nodes claiming its name
 * (see {@link pickClaimant}); a `source()` resolves to its table unless more than one source table claims it; any
 * other value is a relation name, found as written, without quotes, or lowercased.
 */
export function resolveTarget(
  to: string,
  index: RelationIndex,
  fromPackage: string,
): string | undefined {
  const trimmed = to.trim();
  const expr = parseRefExpression(trimmed);
  if (expr?.kind === "ref") {
    return resolveRef(index, expr, fromPackage);
  }
  if (expr?.kind === "source") {
    const key = `${expr.source}.${expr.table}`;
    return index.ambiguousSourceTables.has(key)
      ? undefined
      : index.bySourceTable.get(key);
  }
  return (
    index.byRelationName.get(trimmed) ??
    index.byRelationName.get(trimmed.replaceAll('"', "")) ??
    index.byLowerRelationName.get(trimmed.toLowerCase())
  );
}

/**
 * Narrows the claimants of a `ref()` name by its package and version, when it names them. A version that no claimant
 * carries falls back to all of them, as lineage does.
 */
function resolveRef(
  index: RelationIndex,
  ref: { name: string; package?: string; version?: string },
  fromPackage: string,
): string | undefined {
  let pool = index.claimantsByBaseName.get(ref.name) ?? [];
  if (ref.package !== undefined) {
    const pkg = ref.package;
    pool = pool.filter((c) => c.package_name === pkg);
  }
  if (ref.version !== undefined) {
    const version = ref.version;
    const sameVersion = pool.filter((c) => c.version === version);
    if (sameVersion.length > 0) {
      pool = sameVersion;
    }
  }
  return pickClaimant(pool, fromPackage);
}

/**
 * The claimant a name resolves to from `fromPackage`: the declaring package's own nodes, then the latest version.
 * Otherwise the name is ambiguous and resolves to nothing.
 */
function pickClaimant(
  pool: NameClaimant[],
  fromPackage: string,
): string | undefined {
  let candidates = pool;
  const own = candidates.filter((c) => c.package_name === fromPackage);
  if (own.length > 0) {
    candidates = own;
  }
  if (candidates.length > 1) {
    const latest = candidates.filter((c) => c.isLatestVersion);
    if (latest.length === 1) {
      candidates = latest;
    }
  }
  return candidates.length === 1 ? candidates[0]?.unique_id : undefined;
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

/**
 * Adds each relation's unique_id under the forms its `relation_name` is written in: as written, and without quotes,
 * because adapters differ in quoting. A later relation with the same form overwrites an earlier one.
 */
export function addRelationNames(
  into: Map<string, string>,
  relations: Iterable<{ unique_id: unknown; relation_name?: unknown }>,
): Map<string, string> {
  for (const relation of relations) {
    const { relation_name: name, unique_id: id } = relation;
    if (typeof name !== "string" || typeof id !== "string") {
      continue;
    }
    into.set(name, id);
    const unquoted = name.replaceAll('"', "");
    if (unquoted !== name) {
      into.set(unquoted, id);
    }
  }
  return into;
}

/** Builds the node and source lookups the relationship phases resolve against. */
export function buildRelationIndex(
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap?: SourceMetaMap,
): RelationIndex {
  const sourceTables: Claims = { ids: new Map(), ambiguous: new Set() };
  const index: RelationIndex = {
    claimantsByBaseName: new Map<string, NameClaimant[]>(),
    byRelationName: addRelationNames(
      new Map(),
      [...nodeMetaMap.nodes()].filter((node) => node.relation_name),
    ),
    byLowerRelationName: new Map<string, string>(),
    bySourceTable: sourceTables.ids,
    ambiguousSourceTables: sourceTables.ambiguous,
  };
  for (const [name, id] of index.byRelationName) {
    index.byLowerRelationName.set(name.toLowerCase(), id);
  }
  for (const node of nodeMetaMap.nodes()) {
    const claimants = index.claimantsByBaseName.get(node.name) ?? [];
    claimants.push({
      unique_id: node.unique_id,
      package_name: node.package_name,
      version:
        node.version === null ||
        node.version === undefined ||
        node.version === ""
          ? undefined
          : String(node.version),
      isLatestVersion:
        node.version !== null &&
        node.version !== undefined &&
        node.latest_version !== null &&
        node.latest_version !== undefined &&
        String(node.version) === String(node.latest_version),
    });
    index.claimantsByBaseName.set(node.name, claimants);
  }
  for (const tbl of relationTables(nodeMetaMap, sourceMetaMap)) {
    if (tbl.source_name !== undefined) {
      claim(sourceTables, `${tbl.source_name}.${tbl.name}`, tbl.unique_id);
    }
  }
  return index;
}
