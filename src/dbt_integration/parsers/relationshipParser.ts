import {
  Cardinality,
  ColumnLevelConstraint,
  ConstraintType,
  ModelLevelConstraint,
  NodeMetaData,
  NodeMetaMap,
  Ref,
  SourceMetaMap,
  TestMetaData,
  TestMetaMap,
  TestMetadataRelationships,
} from "../domain";
import { DBTTerminal } from "../terminal";

const DEFAULT_CARDINALITY: Cardinality = "many-to-one";
const RELATIONSHIPS_TEST_NAME = "relationships";
const FOREIGN_KEY: ConstraintType = "foreign_key";

const VALID_CARDINALITIES: ReadonlySet<Cardinality> = new Set([
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
]);

const REF_PATTERN =
  /^ref\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)$/;
const SOURCE_PATTERN =
  /^source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/;

/**
 * Builds `Ref[]` records that describe PK/FK relationships between dbt nodes.
 *
 * - `fromTests` — relationships data tests (Phase 1)
 * - `fromContracts` — model contract foreign_key constraints (Phase 2)
 * - `fromInference` — naming-convention inference (Phase 3)
 * - `fromSemanticEntities` — semantic-layer entity pairings (Phase 4)
 *
 * All four return uniformly-shaped `Ref` records distinguished by the
 * `source` discriminator so downstream consumers can style/filter without
 * the parser knowing about UI.
 */
export class RelationshipParser {
  constructor(private terminal: DBTTerminal) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 — relationships data tests
  // ─────────────────────────────────────────────────────────────────────────

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
  fromTests(testMetaMap: TestMetaMap): Ref[] {
    if (!testMetaMap) {
      return [];
    }
    const uniqueColumns = this.buildUniqueColumnsMap(testMetaMap);
    const refs: Ref[] = [];
    for (const test of testMetaMap.values()) {
      const ref = this.refFromTest(test, uniqueColumns);
      if (ref) {
        refs.push(ref);
      }
    }
    this.terminal.debug(
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
  private buildUniqueColumnsMap(
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

  private refFromTest(
    test: TestMetaData,
    uniqueColumns: Map<string, Set<string>>,
  ): Ref | undefined {
    const metadata = test.test_metadata;
    if (!metadata || metadata.name !== RELATIONSHIPS_TEST_NAME) {
      return undefined;
    }
    if (this.isIgnoredByMeta(test.meta)) {
      this.terminal.debug(
        "RelationshipParser",
        `Skipping ${test.unique_id}: meta.ignore_in_erd is true`,
      );
      return undefined;
    }

    const kwargs = metadata.kwargs as TestMetadataRelationships;
    const toColumn = kwargs?.field;
    const fromColumn = test.column_name;
    if (!toColumn || !fromColumn) {
      this.terminal.debug(
        "RelationshipParser",
        `Skipping ${test.unique_id}: missing field (${toColumn}) or column_name (${fromColumn})`,
      );
      return undefined;
    }

    const dependsOnNodes = (test.depends_on?.nodes ?? []) as string[];
    const endpoints = this.orderEndpoints(dependsOnNodes, test.attached_node);
    if (!endpoints) {
      this.terminal.debug(
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
        this.cardinalityOverrideFromMeta(test.meta) ??
        (fromIsUnique ? "one-to-one" : DEFAULT_CARDINALITY),
      source: "test",
      test_node_id: test.unique_id,
      label: this.labelFromMeta(test.meta),
    };
  }

  /**
   * Determine which end of the pair is "from" (the table carrying the FK)
   * vs "to" (the referenced table). `depends_on.nodes` order is not
   * guaranteed; use `attached_node` — the model the test was declared on —
   * as the authoritative "from" side.
   */
  private orderEndpoints(
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
    return [dependsOnNodes[0], dependsOnNodes[1]];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 — model contract foreign_key
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extract refs from dbt model contracts (1.5+). Reads both column-level
   * (`columns[].constraints[]`) and model-level (`constraints[]`) FK entries.
   *
   * Resolution of the `to` target:
   *   1. If `to` matches `ref('name')`, look up by base name.
   *   2. If `to` matches `source('schema', 'name')`, look up in source map.
   *   3. Otherwise treat as a fully-qualified `relation_name` and match
   *      against the index built from `NodeMetaData.relation_name`.
   *
   * Honors `meta.ignore_in_erd` on the column or node `meta`.
   */
  fromContracts(
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap?: SourceMetaMap,
  ): Ref[] {
    if (!nodeMetaMap) {
      return [];
    }
    const refs: Ref[] = [];
    const index = this.buildRelationIndex(nodeMetaMap, sourceMetaMap);

    for (const node of nodeMetaMap.nodes()) {
      // Column-level FK constraints
      const cols = node.columns ?? {};
      for (const colName in cols) {
        const col = cols[colName];
        if (this.isIgnoredByMeta(col?.meta)) {
          continue;
        }
        for (const constraint of col?.constraints ?? []) {
          const ref = this.refFromColumnConstraint(
            node,
            colName,
            constraint,
            index,
          );
          if (ref) {
            refs.push(ref);
          }
        }
      }
      // Model-level FK constraints
      if (this.isIgnoredByMeta(node.meta)) {
        continue;
      }
      for (const constraint of node.constraints ?? []) {
        const ref = this.refFromModelConstraint(node, constraint, index);
        if (ref) {
          refs.push(ref);
        }
      }
    }
    this.terminal.debug(
      "RelationshipParser",
      `Derived ${refs.length} refs from contracts`,
    );
    return refs;
  }

  private refFromColumnConstraint(
    node: NodeMetaData,
    columnName: string,
    constraint: ColumnLevelConstraint,
    index: RelationIndex,
  ): Ref | undefined {
    if (constraint.type !== FOREIGN_KEY || !constraint.to) {
      return undefined;
    }
    const toTable = this.resolveTo(constraint.to, index);
    if (!toTable) {
      this.terminal.debug(
        "RelationshipParser",
        `Skipping FK on ${node.unique_id}.${columnName}: cannot resolve target ${constraint.to}`,
      );
      return undefined;
    }
    const toColumns = constraint.to_columns?.length
      ? constraint.to_columns
      : [columnName];
    const fromIsUnique = this.columnHasUniqueConstraint(node, columnName);
    const colMeta = node.columns?.[columnName]?.meta;
    return {
      id: `contract:${node.unique_id}.${columnName}->${toTable}`,
      from: { table: node.unique_id, columns: [columnName] },
      to: { table: toTable, columns: toColumns },
      cardinality:
        this.cardinalityOverrideFromMeta(colMeta) ??
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
  private columnHasUniqueConstraint(
    node: NodeMetaData,
    columnName: string,
  ): boolean {
    const constraints = node.columns?.[columnName]?.constraints ?? [];
    return constraints.some(
      (c) => c.type === "unique" || c.type === "primary_key",
    );
  }

  private refFromModelConstraint(
    node: NodeMetaData,
    constraint: ModelLevelConstraint,
    index: RelationIndex,
  ): Ref | undefined {
    if (constraint.type !== FOREIGN_KEY || !constraint.to) {
      return undefined;
    }
    const fromColumns = constraint.columns ?? [];
    if (fromColumns.length === 0) {
      this.terminal.debug(
        "RelationshipParser",
        `Skipping model-level FK on ${node.unique_id}: no source columns specified`,
      );
      return undefined;
    }
    const toTable = this.resolveTo(constraint.to, index);
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
      this.columnHasUniqueConstraint(node, c),
    );
    return {
      id: `contract:${node.unique_id}.[${fromColumns.join(",")}]->${toTable}`,
      from: { table: node.unique_id, columns: fromColumns },
      to: { table: toTable, columns: toColumns },
      cardinality:
        this.cardinalityOverrideFromMeta(node.meta) ??
        (fromIsUnique ? "one-to-one" : DEFAULT_CARDINALITY),
      source: "contract",
    };
  }

  /**
   * Resolve a contract `to` field to a target unique_id. Supports
   * `ref('name')`, `source('schema', 'name')`, and fully-qualified
   * relation names like `"db"."schema"."table"`.
   */
  private resolveTo(to: string, index: RelationIndex): string | undefined {
    const trimmed = to.trim();
    const refMatch = REF_PATTERN.exec(trimmed);
    if (refMatch) {
      return index.byBaseName.get(refMatch[1]);
    }
    const sourceMatch = SOURCE_PATTERN.exec(trimmed);
    if (sourceMatch) {
      return index.bySourceKey.get(`${sourceMatch[1]}.${sourceMatch[2]}`);
    }
    // Fully-qualified relation name lookup. Try exact and case-insensitive
    // matches because adapters quote/case differently.
    return (
      index.byRelationName.get(trimmed) ??
      index.byRelationName.get(trimmed.toLowerCase())
    );
  }

  /** Build node/source lookup indices once per `fromContracts` call. */
  private buildRelationIndex(
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap?: SourceMetaMap,
  ): RelationIndex {
    const byBaseName = new Map<string, string>();
    const byRelationName = new Map<string, string>();
    for (const node of nodeMetaMap.nodes()) {
      byBaseName.set(node.name, node.unique_id);
      if (node.relation_name) {
        byRelationName.set(node.relation_name, node.unique_id);
        byRelationName.set(node.relation_name.toLowerCase(), node.unique_id);
      }
    }
    const bySourceKey = new Map<string, string>();
    if (sourceMetaMap) {
      for (const source of sourceMetaMap.values()) {
        for (const tbl of source.tables ?? []) {
          bySourceKey.set(`${source.name}.${tbl.name}`, source.unique_id);
        }
      }
    }
    return { byBaseName, byRelationName, bySourceKey };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3 — naming-convention inference
  // ─────────────────────────────────────────────────────────────────────────

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
  fromInference(
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap: SourceMetaMap | undefined,
    options: InferenceOptions = {},
  ): Ref[] {
    if (!nodeMetaMap) {
      return [];
    }
    const minConfidence = options.minConfidence ?? 0.6;
    const includeSources = options.includeSources ?? false;
    const allowSelfReference = options.allowSelfReference ?? false;

    // Index candidate targets by their base name (singular and plural variants).
    const targets = new Map<string, InferenceTarget>();
    for (const node of nodeMetaMap.nodes()) {
      this.indexTarget(targets, node.name, {
        unique_id: node.unique_id,
        baseName: node.name,
        columns: Object.keys(node.columns ?? {}),
      });
    }
    if (includeSources && sourceMetaMap) {
      for (const source of sourceMetaMap.values()) {
        for (const tbl of source.tables ?? []) {
          this.indexTarget(targets, tbl.name, {
            unique_id: source.unique_id,
            baseName: tbl.name,
            columns: Object.keys(tbl.columns ?? {}),
          });
        }
      }
    }

    const refs: Ref[] = [];
    for (const node of nodeMetaMap.nodes()) {
      if (this.isIgnoredByMeta(node.meta)) {
        continue;
      }
      const cols = node.columns ?? {};
      for (const colName in cols) {
        if (this.isIgnoredByMeta(cols[colName]?.meta)) {
          continue;
        }
        const candidate = this.matchColumnToTarget(colName, targets);
        if (!candidate) {
          continue;
        }
        if (
          !allowSelfReference &&
          candidate.target.unique_id === node.unique_id
        ) {
          continue;
        }
        if (candidate.confidence < minConfidence) {
          continue;
        }
        const toColumn = this.pickTargetColumn(colName, candidate.target);
        if (!toColumn) {
          continue;
        }
        refs.push({
          id: `inferred:${node.unique_id}.${colName}->${candidate.target.unique_id}.${toColumn}`,
          from: { table: node.unique_id, columns: [colName] },
          to: { table: candidate.target.unique_id, columns: [toColumn] },
          cardinality: DEFAULT_CARDINALITY,
          source: "inferred",
          confidence: candidate.confidence,
        });
      }
    }
    this.terminal.debug(
      "RelationshipParser",
      `Derived ${refs.length} refs from naming inference (minConfidence=${minConfidence})`,
    );
    return refs;
  }

  private indexTarget(
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

  private matchColumnToTarget(
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
    const compact = stem.replace(/_/g, "");
    for (const [key, target] of targets) {
      if (key.replace(/_/g, "") === compact) {
        return { target, confidence: 0.6 };
      }
    }
    return undefined;
  }

  /**
   * Pick which target column the FK references. Preference: same-named
   * column on the target → `id` → `<base>_id` → first column.
   */
  private pickTargetColumn(
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

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 4 — semantic-layer entity pairings
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extract refs by pairing `foreign` entities with matching `primary` (or
   * `unique`) entities of the same name across semantic models. Each pair
   * yields a ref from the foreign side's anchor model to the primary side's.
   *
   * If a semantic model lacks a resolved `model_unique_id`, the ref is
   * skipped — we don't fabricate identifiers.
   */
  fromSemanticEntities(
    semanticModelMetaMap: import("../domain").SemanticModelMetaMap | undefined,
  ): Ref[] {
    if (!semanticModelMetaMap || semanticModelMetaMap.size === 0) {
      return [];
    }
    // Index primary/unique entities by name.
    type EntityPosting = { sm_unique_id: string; model: string; expr: string };
    const primaryByName = new Map<string, EntityPosting>();
    for (const sm of semanticModelMetaMap.values()) {
      if (!sm.model_unique_id) {
        continue;
      }
      for (const e of sm.entities) {
        if (e.type === "primary" || e.type === "unique") {
          // Primary takes precedence over unique on collision.
          if (e.type === "primary" || !primaryByName.has(e.name)) {
            primaryByName.set(e.name, {
              sm_unique_id: sm.unique_id,
              model: sm.model_unique_id,
              expr: e.expr ?? e.name,
            });
          }
        }
      }
    }

    const refs: Ref[] = [];
    for (const sm of semanticModelMetaMap.values()) {
      if (!sm.model_unique_id) {
        continue;
      }
      for (const e of sm.entities) {
        if (e.type !== "foreign") {
          continue;
        }
        const target = primaryByName.get(e.name);
        if (!target) {
          this.terminal.debug(
            "RelationshipParser",
            `Skipping foreign entity ${sm.unique_id}.${e.name}: no primary/unique match`,
          );
          continue;
        }
        if (target.sm_unique_id === sm.unique_id) {
          continue;
        }
        const fromColumn = e.expr ?? e.name;
        refs.push({
          id: `semantic:${sm.unique_id}.${e.name}->${target.sm_unique_id}`,
          from: { table: sm.model_unique_id, columns: [fromColumn] },
          to: { table: target.model, columns: [target.expr] },
          cardinality: DEFAULT_CARDINALITY,
          source: "semantic",
        });
      }
    }
    this.terminal.debug(
      "RelationshipParser",
      `Derived ${refs.length} refs from semantic entities`,
    );
    return refs;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ─────────────────────────────────────────────────────────────────────────

  private isIgnoredByMeta(meta: any): boolean {
    return Boolean(meta && meta.ignore_in_erd === true);
  }

  /**
   * Soft cardinality override from a `meta.relationship_type` value.
   * Returns `undefined` when meta is absent or carries an unknown value
   * so callers can fall back to detection logic.
   */
  private cardinalityOverrideFromMeta(meta: any): Cardinality | undefined {
    const raw = meta?.relationship_type;
    if (
      typeof raw === "string" &&
      VALID_CARDINALITIES.has(raw as Cardinality)
    ) {
      return raw as Cardinality;
    }
    return undefined;
  }

  private labelFromMeta(meta: any): string | undefined {
    const raw = meta?.relationship_label;
    return typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
}

interface RelationIndex {
  byBaseName: Map<string, string>;
  byRelationName: Map<string, string>;
  bySourceKey: Map<string, string>;
}

interface InferenceTarget {
  unique_id: string;
  baseName: string;
  columns: string[];
}

export interface InferenceOptions {
  /** Default 0.6. Refs scoring below this are dropped. */
  minConfidence?: number;
  /** Default false. When true, source tables are candidate targets for FKs. */
  includeSources?: boolean;
  /** Default false. When true, a column can infer-FK to its own table. */
  allowSelfReference?: boolean;
}
