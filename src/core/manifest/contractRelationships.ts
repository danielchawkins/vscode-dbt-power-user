import type { Log } from "../log";
import {
  type RelationIndex,
  buildRelationIndex,
  resolveTarget,
} from "./relationIndex";
import { isIgnoredByMeta } from "./relationshipInference";
import {
  cardinalityOverrideFromMeta,
  DEFAULT_CARDINALITY,
} from "./relationshipMeta";
import type {
  ConstraintType,
  NodeMetaData,
  NodeMetaMap,
  SourceMetaMap,
  Ref,
  ColumnLevelConstraint,
  ModelLevelConstraint,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 — model contract foreign_key
// ─────────────────────────────────────────────────────────────────────────
const FOREIGN_KEY: ConstraintType = "foreign_key";
interface ContractContext {
  terminal: Pick<Log, "debug">;
  index: RelationIndex;
}
interface ColumnOnNode {
  node: NodeMetaData;
  columnName: string;
}
/**
 * Extract refs from dbt model contracts (1.5+). Reads both column-level
 * (`columns[].constraints[]`) and model-level (`constraints[]`) FK entries.
 *
 * The `to` target resolves through `resolveTarget` (in `relationIndex.ts`): a
 * `ref()` or `source()` expression, or else a fully-qualified `relation_name`.
 *
 * Honors `meta.ignore_in_erd` on the column or node `meta`.
 */
export function refsFromContracts(
  terminal: Pick<Log, "debug">,
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap?: SourceMetaMap,
): Ref[] {
  if (!nodeMetaMap) {
    return [];
  }
  const refs: Ref[] = [];
  const ctx: ContractContext = {
    terminal,
    index: buildRelationIndex(nodeMetaMap, sourceMetaMap),
  };
  for (const node of nodeMetaMap.nodes()) {
    refs.push(...columnLevelRefs(ctx, node), ...modelLevelRefs(ctx, node));
  }
  terminal.debug(
    "RelationshipParser",
    `Derived ${refs.length} refs from contracts`,
  );
  return refs;
}
/** Column-level FK refs on `node`, skipping columns that opt out with `meta.ignore_in_erd`. */
function columnLevelRefs(ctx: ContractContext, node: NodeMetaData): Ref[] {
  const refs: Ref[] = [];
  const cols = node.columns ?? {};
  for (const colName in cols) {
    const col = cols[colName];
    if (isIgnoredByMeta(col?.meta)) {
      continue;
    }
    for (const constraint of col?.constraints ?? []) {
      const ref = refFromColumnConstraint(
        ctx,
        { node, columnName: colName },
        constraint,
      );
      if (ref) {
        refs.push(ref);
      }
    }
  }
  return refs;
}

/** Model-level FK refs on `node`, unless the node opts out with `meta.ignore_in_erd`. */
function modelLevelRefs(ctx: ContractContext, node: NodeMetaData): Ref[] {
  const refs: Ref[] = [];
  if (isIgnoredByMeta(node.meta)) {
    return refs;
  }
  for (const constraint of node.constraints ?? []) {
    const ref = refFromModelConstraint(ctx, node, constraint);
    if (ref) {
      refs.push(ref);
    }
  }
  return refs;
}

function refFromColumnConstraint(
  ctx: ContractContext,
  column: ColumnOnNode,
  constraint: ColumnLevelConstraint,
): Ref | undefined {
  const { node, columnName } = column;
  if (constraint.type !== FOREIGN_KEY || !constraint.to) {
    return undefined;
  }
  const toTable = resolveTarget(constraint.to, ctx.index, node.package_name);
  if (!toTable) {
    ctx.terminal.debug(
      "RelationshipParser",
      `Skipping FK on ${node.unique_id}.${columnName}: cannot resolve target ${constraint.to}`,
    );
    return undefined;
  }
  const toColumns = constraint.to_columns?.length
    ? constraint.to_columns
    : [columnName];
  const fromIsUnique = columnHasUniqueConstraint(node, columnName);
  const colMeta = node.columns?.[columnName]?.meta;
  return {
    id: `contract:${node.unique_id}.${columnName}->${toTable}`,
    from: { table: node.unique_id, columns: [columnName] },
    to: { table: toTable, columns: toColumns },
    cardinality:
      cardinalityOverrideFromMeta(colMeta) ??
      (fromIsUnique ? "one-to-one" : DEFAULT_CARDINALITY),
    source: "contract",
  };
}
/**
 * True iff the column carries a `unique` or `primary_key` contract
 * constraint. Used by Phase 2 cardinality detection: a unique FK column
 * means each row of the source table maps to at most one row of the
 * target → one-to-one rather than the many-to-one default.
 */
function columnHasUniqueConstraint(
  node: NodeMetaData,
  columnName: string,
): boolean {
  const constraints = node.columns?.[columnName]?.constraints ?? [];
  return constraints.some(
    (c) => c.type === "unique" || c.type === "primary_key",
  );
}
function refFromModelConstraint(
  ctx: ContractContext,
  node: NodeMetaData,
  constraint: ModelLevelConstraint,
): Ref | undefined {
  if (constraint.type !== FOREIGN_KEY || !constraint.to) {
    return undefined;
  }
  const fromColumns = constraint.columns ?? [];
  if (fromColumns.length === 0) {
    ctx.terminal.debug(
      "RelationshipParser",
      `Skipping model-level FK on ${node.unique_id}: no source columns specified`,
    );
    return undefined;
  }
  const toTable = resolveTarget(constraint.to, ctx.index, node.package_name);
  if (!toTable) {
    return undefined;
  }
  const toColumns = constraint.to_columns?.length
    ? constraint.to_columns
    : fromColumns;
  // Multi-column FK is one-to-one only if every source column is unique
  // (composite PK semantics). Conservative default of many-to-one
  // otherwise.
  const fromIsUnique = fromColumns.every((c) =>
    columnHasUniqueConstraint(node, c),
  );
  return {
    id: `contract:${node.unique_id}.[${fromColumns.join(",")}]->${toTable}`,
    from: { table: node.unique_id, columns: fromColumns },
    to: { table: toTable, columns: toColumns },
    cardinality:
      cardinalityOverrideFromMeta(node.meta) ??
      (fromIsUnique ? "one-to-one" : DEFAULT_CARDINALITY),
    source: "contract",
  };
}
