import type { Log } from "../log";
import { relationTables } from "./relationIndex";
import type {
  Cardinality,
  Meta,
  NodeMetaData,
  NodeMetaMap,
  Ref,
  SourceMetaMap,
} from "./types";

const DEFAULT_CARDINALITY: Cardinality = "many-to-one";

interface InferenceTarget {
  unique_id: string;
  baseName: string;
  columns: string[];
}

export interface InferenceOptions {
  /** Default 0.6. Refs scoring below this are dropped. */
  minConfidence?: number;
  /** Default false. When true, source tables are candidate targets for FKs. */
  includeSources?: boolean | undefined;
  /** Default false. When true, a column can infer-FK to its own table. */
  allowSelfReference?: boolean;
}

/** Whether a node, column or test opts out of the ERD overlay with `meta.ignore_in_erd`. */
export function isIgnoredByMeta(meta: Meta): boolean {
  return meta?.ignore_in_erd === true;
}

/**
 * Infer refs from column-naming conventions. Default rule:
 *   - Column name is `<x>_id`.
 *   - Some other table is named `<x>` or `<x>s` (singular/plural).
 *   - That table has a column matching the FK column name (typically `id`,
 *     `<x>_id`, or the same name).
 *
 * Confidence scoring:
 *   - Singular-vs-plural table-name match: 1.0 for exact, 0.8 for plural,
 *     0.6 for stripped underscores, 0 otherwise.
 *   - Self-reference (column on table X pointing to X): clamped to 0
 *     unless `allowSelfReference` is true.
 *   - Final score = name_score; future rules can multiply in column-count
 *     match and schema proximity.
 *
 * Honors `meta.ignore_in_erd` per column. Sources excluded by default
 * (set `includeSources: true` to include them).
 */
export function inferRefs({
  terminal,
  nodeMetaMap,
  sourceMetaMap,
  options = {},
}: {
  terminal: Pick<Log, "debug">;
  nodeMetaMap: NodeMetaMap;
  sourceMetaMap: SourceMetaMap | undefined;
  options?: InferenceOptions;
}): Ref[] {
  if (!nodeMetaMap) {
    return [];
  }
  const minConfidence = options.minConfidence ?? 0.6;
  const includeSources = options.includeSources ?? false;
  const allowSelfReference = options.allowSelfReference ?? false;

  const ctx: ColumnInference = {
    targets: inferenceTargets(nodeMetaMap, sourceMetaMap, includeSources),
    minConfidence,
    allowSelfReference,
  };
  const refs: Ref[] = [];
  for (const node of nodeMetaMap.nodes()) {
    if (isIgnoredByMeta(node.meta)) {
      continue;
    }
    const cols = node.columns ?? {};
    for (const colName in cols) {
      if (isIgnoredByMeta(cols[colName]?.meta)) {
        continue;
      }
      const ref = inferColumnRef(node, colName, ctx);
      if (ref) {
        refs.push(ref);
      }
    }
  }
  terminal.debug(
    "RelationshipParser",
    `Derived ${refs.length} refs from naming inference (minConfidence=${minConfidence})`,
  );
  return refs;
}

/**
 * Index the candidate FK targets by base name (singular and plural variants).
 * Sources are only indexed when `includeSources` is set.
 */
function inferenceTargets(
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap: SourceMetaMap | undefined,
  includeSources: boolean,
): Map<string, InferenceTarget> {
  const targets = new Map<string, InferenceTarget>();
  for (const table of relationTables(nodeMetaMap, sourceMetaMap)) {
    if (table.source_name === undefined || includeSources) {
      indexTarget(targets, table.name, {
        unique_id: table.unique_id,
        baseName: table.name,
        columns: Object.keys(table.columns),
      });
    }
  }
  return targets;
}

interface ColumnInference {
  targets: Map<string, InferenceTarget>;
  minConfidence: number;
  allowSelfReference: boolean;
}

/**
 * The inferred ref for one column of `node`, or `undefined` when no candidate
 * target matches, the match is self-referencing or below `minConfidence`, or
 * no target column can be picked.
 */
function inferColumnRef(
  node: NodeMetaData,
  colName: string,
  ctx: ColumnInference,
): Ref | undefined {
  const candidate = matchColumnToTarget(colName, ctx.targets);
  if (!candidate) {
    return undefined;
  }
  if (
    !ctx.allowSelfReference &&
    candidate.target.unique_id === node.unique_id
  ) {
    return undefined;
  }
  if (candidate.confidence < ctx.minConfidence) {
    return undefined;
  }
  const toColumn = pickTargetColumn(colName, candidate.target);
  if (!toColumn) {
    return undefined;
  }
  return {
    id: `inferred:${node.unique_id}.${colName}->${candidate.target.unique_id}.${toColumn}`,
    from: { table: node.unique_id, columns: [colName] },
    to: { table: candidate.target.unique_id, columns: [toColumn] },
    cardinality: DEFAULT_CARDINALITY,
    source: "inferred",
    confidence: candidate.confidence,
  };
}

function indexTarget(
  index: Map<string, InferenceTarget>,
  name: string,
  target: InferenceTarget,
) {
  index.set(name, target);
  // Plural variants — register if not already taken by a real model.
  if (!name.endsWith("s")) {
    const plural = name + "s";
    if (!index.has(plural)) {
      index.set(plural, target);
    }
  }
}

function matchColumnToTarget(
  columnName: string,
  targets: Map<string, InferenceTarget>,
): { target: InferenceTarget; confidence: number } | undefined {
  if (!columnName.endsWith("_id")) {
    return undefined;
  }
  const stem = columnName.slice(0, -3); // strip `_id`
  if (!stem) {
    return undefined;
  }
  // Exact stem match (singular).
  const exact = targets.get(stem);
  if (exact) {
    return { target: exact, confidence: 1.0 };
  }
  // Plural match.
  const plural = targets.get(stem + "s");
  if (plural) {
    return { target: plural, confidence: 0.8 };
  }
  // Underscore stripped (e.g. `customer_account_id` → `customer_accounts`).
  const compact = stem.replaceAll("_", "");
  for (const [key, target] of targets) {
    if (key.replaceAll("_", "") === compact) {
      return { target, confidence: 0.6 };
    }
  }
  return undefined;
}

/**
 * Pick which target column the FK references. Preference: same-named
 * column on the target → `id` → `<base>_id` → first column.
 */
function pickTargetColumn(
  fromColumn: string,
  target: InferenceTarget,
): string | undefined {
  if (target.columns.includes(fromColumn)) {
    return fromColumn;
  }
  if (target.columns.includes("id")) {
    return "id";
  }
  const conventional = `${target.baseName}_id`;
  if (target.columns.includes(conventional)) {
    return conventional;
  }
  return target.columns[0];
}
