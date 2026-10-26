import type { Log } from "../log";
import { isIgnoredByMeta } from "./relationshipInference";
import {
  cardinalityOverrideFromMeta,
  DEFAULT_CARDINALITY,
  labelFromMeta,
} from "./relationshipMeta";
import type {
  TestMetaMap,
  Ref,
  TestMetaData,
  TestMetadataRelationships,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────
// Phase 1 — relationships data tests
// ─────────────────────────────────────────────────────────────────────────
const RELATIONSHIPS_TEST_NAME = "relationships";
/**
 * Extract refs from dbt `relationships` data tests.
 *
 * A `relationships` test has:
 *   - `test_metadata.name === "relationships"`
 *   - `test_metadata.kwargs.field` → column on the target table
 *   - `column_name` on the test node → column on the source table
 *   - `depends_on.nodes` → two unique_ids: the source and target models/sources
 *   - `attached_node` → the unique_id of the model the test is declared on (= "from" side)
 *
 * Honors `meta.relationship_type` for cardinality override and
 * `meta.ignore_in_erd` for opt-out (read off the test's merged meta —
 * `TestParser` populates this from the parent column's meta).
 */
export function refsFromTests(
  terminal: Pick<Log, "debug">,
  testMetaMap: TestMetaMap,
): Ref[] {
  if (!testMetaMap) {
    return [];
  }
  const uniqueColumns = buildUniqueColumnsMap(testMetaMap);
  const refs: Ref[] = [];
  for (const test of testMetaMap.values()) {
    const ref = refFromTest(terminal, test, uniqueColumns);
    if (ref) {
      refs.push(ref);
    }
  }
  terminal.debug(
    "RelationshipParser",
    `Derived ${refs.length} refs from ${testMetaMap.size} tests`,
  );
  return refs;
}
/**
 * Index `unique` data tests by attached table → set of unique columns.
 * Used to detect one-to-one cardinality: if a `relationships` test's
 * `column_name` is also unique-tested on the same table, the source
 * row is unique → relationship is one-to-one rather than many-to-one.
 */
function buildUniqueColumnsMap(
  testMetaMap: TestMetaMap,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const test of testMetaMap.values()) {
    if (test.test_metadata?.name !== "unique") {
      continue;
    }
    const tbl = test.attached_node;
    const col = test.column_name;
    if (!tbl || !col) {
      continue;
    }
    if (!map.has(tbl)) {
      map.set(tbl, new Set());
    }
    map.get(tbl)!.add(col);
  }
  return map;
}
function refFromTest(
  terminal: Pick<Log, "debug">,
  test: TestMetaData,
  uniqueColumns: Map<string, Set<string>>,
): Ref | undefined {
  const metadata = test.test_metadata;
  if (!metadata || metadata.name !== RELATIONSHIPS_TEST_NAME) {
    return undefined;
  }
  if (isIgnoredByMeta(test.meta)) {
    terminal.debug(
      "RelationshipParser",
      `Skipping ${test.unique_id}: meta.ignore_in_erd is true`,
    );
    return undefined;
  }

  const kwargs = metadata.kwargs as TestMetadataRelationships;
  const toColumn = kwargs?.field;
  const fromColumn = test.column_name;
  if (!toColumn || !fromColumn) {
    terminal.debug(
      "RelationshipParser",
      `Skipping ${test.unique_id}: missing field (${toColumn}) or column_name (${fromColumn})`,
    );
    return undefined;
  }

  const dependsOnNodes = (test.depends_on?.nodes ?? []) as string[];
  const endpoints = orderEndpoints(dependsOnNodes, test.attached_node);
  if (!endpoints) {
    terminal.debug(
      "RelationshipParser",
      `Skipping ${test.unique_id}: expected 2 depends_on nodes, got ${dependsOnNodes.length}`,
    );
    return undefined;
  }
  const [fromTable, toTable] = endpoints;

  const fromIsUnique = uniqueColumns.get(fromTable)?.has(fromColumn) ?? false;
  return {
    id: `test:${test.unique_id}`,
    from: { table: fromTable, columns: [fromColumn] },
    to: { table: toTable, columns: [toColumn] },
    cardinality:
      cardinalityOverrideFromMeta(test.meta) ??
      (fromIsUnique ? "one-to-one" : DEFAULT_CARDINALITY),
    source: "test",
    test_node_id: test.unique_id,
    label: labelFromMeta(test.meta),
  };
}
/**
 * Determine which end of the pair is "from" (the table carrying the FK)
 * vs "to" (the referenced table). `depends_on.nodes` order is not
 * guaranteed; use `attached_node` — the model the test was declared on —
 * as the authoritative "from" side.
 */
function orderEndpoints(
  dependsOnNodes: string[],
  attachedNode: string | undefined,
): [string, string] | undefined {
  if (dependsOnNodes.length < 2) {
    return undefined;
  }
  if (attachedNode && dependsOnNodes.includes(attachedNode)) {
    const to = dependsOnNodes.find((n) => n !== attachedNode);
    if (!to) {
      return undefined;
    }
    return [attachedNode, to];
  }
  const [first, second] = dependsOnNodes;
  return first !== undefined && second !== undefined
    ? [first, second]
    : undefined;
}
