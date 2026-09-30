import { DBTGraphType } from "./graphParser";

export interface ChildrenParentMetaMap {
  /** Full build-order parent graph from `depends_on.nodes` — nothing removed. */
  parentMetaMap: DBTGraphType;
  /** Full build-order child graph (reverse of `parentMetaMap`). */
  childMetaMap: DBTGraphType;
  /**
   * Subset of `parentMetaMap`: for each child, the parent edges that exist ONLY
   * because of a declared foreign-key constraint (`to: ref(...)` / `to: source(...)`)
   * whose target relation is not referenced by the model's SQL. These edges are
   * still present in `parentMetaMap`/`childMetaMap`; this map flags them so a
   * data-flow consumer (e.g. the lineage panel) can hide or style them without
   * altering the dependency graph used for build order, depth, or impact analysis.
   */
  constraintOnlyParents: DBTGraphType;
}

export class ChildrenParentParser {
  createChildrenParentMetaMap(
    nodesMap: Record<string, any>,
    sourcesMap?: Record<string, any>,
  ): Promise<ChildrenParentMetaMap> {
    const parentMetaMap: DBTGraphType = {};
    const childMetaMap: DBTGraphType = {};
    const constraintOnlyParents: DBTGraphType = {};

    const refIndex = buildRefIndex(nodesMap);
    const sourceIndex = buildSourceIndex(sourcesMap);
    const relationIndex = buildRelationIndex(nodesMap, sourcesMap);

    Object.values(nodesMap).forEach((node) => {
      const dependsOn: string[] = node.depends_on?.nodes || [];
      // The build-order graph stays complete — no edge is ever removed.
      parentMetaMap[node.unique_id] = dependsOn;

      // Classify (don't drop) edges that exist only because of a FK constraint.
      const constraintTargets = collectConstraintTargets(
        node,
        refIndex,
        sourceIndex,
        relationIndex,
      );
      if (constraintTargets.size === 0) {
        return;
      }
      const body = pickBody(node);
      const fkOnly = dependsOn.filter((parentId) => {
        if (!constraintTargets.has(parentId)) {
          return false; // not a constraint target — pure SQL / hook / programmatic
        }
        if (body === null) {
          return false; // no body to inspect — don't claim it's FK-only
        }
        const parent = nodesMap[parentId] ?? sourcesMap?.[parentId];
        // FK-only iff the parent's relation does NOT appear in the model body.
        return !parentAppearsInBody(parent, body);
      });
      if (fkOnly.length > 0) {
        constraintOnlyParents[node.unique_id] = fkOnly;
      }
    });

    // Build child map by reversing relationships (full build-order graph).
    Object.entries(parentMetaMap).forEach(([child, parents]) => {
      parents.forEach((parent) => {
        childMetaMap[parent] = childMetaMap[parent] || [];
        childMetaMap[parent].push(child);
      });
    });

    return Promise.resolve({
      parentMetaMap,
      childMetaMap,
      constraintOnlyParents,
    });
  }
}

// -----------------------------------------------------------------------------
// Indexes
// -----------------------------------------------------------------------------

function buildRefIndex(nodesMap: Record<string, any>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  Object.values(nodesMap).forEach((node) => {
    if (!node?.unique_id || !node?.name) {
      return;
    }
    const pkg = node.package_name;
    const ver = node.version;
    addToIndex(index, refKey(node.name), node.unique_id);
    if (pkg) {
      addToIndex(index, refKey(node.name, pkg), node.unique_id);
    }
    if (ver !== undefined && ver !== null && ver !== "") {
      addToIndex(index, refKey(node.name, undefined, ver), node.unique_id);
      if (pkg) {
        addToIndex(index, refKey(node.name, pkg, ver), node.unique_id);
      }
    }
  });
  return index;
}

function buildSourceIndex(
  sourcesMap?: Record<string, any>,
): Map<string, string> {
  const index = new Map<string, string>();
  if (!sourcesMap) {
    return index;
  }
  Object.values(sourcesMap).forEach((source) => {
    if (!source?.unique_id || !source?.source_name || !source?.name) {
      return;
    }
    index.set(sourceKey(source.source_name, source.name), source.unique_id);
  });
  return index;
}

function buildRelationIndex(
  nodesMap: Record<string, any>,
  sourcesMap?: Record<string, any>,
): Map<string, string> {
  // Maps a normalized relation_name (e.g. `"db"."schema"."table"`) to unique_id.
  // After `dbt compile`, the `constraints[].to` field is rewritten from
  // `ref('X')` to the relation_name, so we need this lookup too.
  const index = new Map<string, string>();
  const add = (relation: unknown, uniqueId: unknown) => {
    if (typeof relation !== "string" || typeof uniqueId !== "string") {
      return;
    }
    index.set(relation, uniqueId);
    // Also index the unquoted form for adapters that don't quote.
    const unquoted = relation.replace(/"/g, "");
    if (unquoted !== relation) {
      index.set(unquoted, uniqueId);
    }
  };
  Object.values(nodesMap).forEach((node) =>
    add(node?.relation_name, node?.unique_id),
  );
  if (sourcesMap) {
    Object.values(sourcesMap).forEach((src) =>
      add(src?.relation_name, src?.unique_id),
    );
  }
  return index;
}

function addToIndex(index: Map<string, string[]>, key: string, value: string) {
  const existing = index.get(key);
  if (existing) {
    if (!existing.includes(value)) {
      existing.push(value);
    }
  } else {
    index.set(key, [value]);
  }
}

// -----------------------------------------------------------------------------
// Constraint target collection
// -----------------------------------------------------------------------------

function collectConstraintTargets(
  node: any,
  refIndex: Map<string, string[]>,
  sourceIndex: Map<string, string>,
  relationIndex: Map<string, string>,
): Set<string> {
  const targets = new Set<string>();

  const handleConstraint = (constraint: any) => {
    if (!constraint || constraint.type !== "foreign_key") {
      return;
    }
    const to = constraint.to;
    if (typeof to !== "string" || to.length === 0) {
      return;
    }
    const resolved = resolveConstraintTo(
      to,
      refIndex,
      sourceIndex,
      relationIndex,
    );
    resolved.forEach((id) => targets.add(id));
  };

  const columns = node?.columns;
  if (columns && typeof columns === "object") {
    Object.values(columns).forEach((col: any) => {
      const constraints = col?.constraints;
      if (Array.isArray(constraints)) {
        constraints.forEach(handleConstraint);
      }
    });
  }
  if (Array.isArray(node?.constraints)) {
    node.constraints.forEach(handleConstraint);
  }

  return targets;
}

function resolveConstraintTo(
  to: string,
  refIndex: Map<string, string[]>,
  sourceIndex: Map<string, string>,
  relationIndex: Map<string, string>,
): string[] {
  // After `dbt compile`, `to` is rewritten to the relation_name like
  // `"db"."schema"."table"` (or unquoted on adapters that don't quote).
  const direct = relationIndex.get(to);
  if (direct) {
    return [direct];
  }

  // Parse-time form: `ref('name')`, `ref('pkg', 'name')`, or
  // `source('src', 'tbl')`. Strip whitespace and try regex.
  const trimmed = to.trim();

  const refMatch = trimmed.match(
    /^ref\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?(?:\s*,\s*v?=?\s*([^)]+))?\s*\)$/,
  );
  if (refMatch) {
    const a = refMatch[1];
    const b = refMatch[2];
    const v = refMatch[3]?.trim().replace(/['"]/g, "");
    // ref('name') → a=name, b=undefined
    // ref('pkg', 'name') → a=pkg, b=name
    const name = b ?? a;
    const pkg = b ? a : undefined;
    return lookupRef(refIndex, { name, package: pkg, version: v });
  }

  const sourceMatch = trimmed.match(
    /^source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/,
  );
  if (sourceMatch) {
    const id = sourceIndex.get(sourceKey(sourceMatch[1], sourceMatch[2]));
    return id ? [id] : [];
  }

  return [];
}

function lookupRef(
  index: Map<string, string[]>,
  entry: {
    name: string;
    package?: string | null;
    version?: string | number | null;
  },
): string[] {
  const candidates: string[] = [];
  if (entry.package) {
    if (entry.version) {
      candidates.push(refKey(entry.name, entry.package, entry.version));
    }
    candidates.push(refKey(entry.name, entry.package));
  }
  if (entry.version) {
    candidates.push(refKey(entry.name, undefined, entry.version));
  }
  candidates.push(refKey(entry.name));
  for (const key of candidates) {
    const hit = index.get(key);
    if (hit) {
      return hit;
    }
  }
  return [];
}

// -----------------------------------------------------------------------------
// Body inspection: does the parent appear in the model's SQL?
// -----------------------------------------------------------------------------

type Body =
  { kind: "compiled"; text: string } | { kind: "raw"; text: string } | null;

function pickBody(node: any): Body {
  const compiled = node?.compiled_code;
  if (typeof compiled === "string" && compiled.length > 0) {
    return { kind: "compiled", text: compiled };
  }
  const raw = node?.raw_code;
  if (typeof raw === "string" && raw.length > 0) {
    return { kind: "raw", text: raw };
  }
  return null;
}

function parentAppearsInBody(parent: any, body: Body): boolean {
  if (!parent || body === null) {
    return true; // conservatively treat as data flow
  }

  const relation = parent.relation_name;
  if (typeof relation === "string" && relation.length > 0) {
    if (body.text.includes(relation)) {
      return true;
    }
    const unquoted = relation.replace(/"/g, "");
    if (unquoted !== relation && body.text.includes(unquoted)) {
      return true;
    }
  }

  // After `dbt compile`, all Jinja is resolved into relation names. A `ref(...)`
  // appearing in `compiled_code` is necessarily in a comment, not a live
  // reference — don't fall back to the regex match against the compiled body.
  if (body.kind === "compiled") {
    return false;
  }

  // Pre-compile (raw_code only): scan for `{{ ref('name') }}` or
  // `{{ source(...) }}` patterns. Accepts false positives from SQL comments;
  // acceptable trade-off because the manifest path that lacks `compiled_code`
  // is the parse-only path before the user has compiled.
  const name = parent.name;
  const pkg = parent.package_name;
  if (typeof name === "string" && name.length > 0) {
    if (containsRefCall(body.text, name, pkg)) {
      return true;
    }
  }

  const sourceName = parent.source_name;
  const sourceTable = parent.name;
  if (
    typeof sourceName === "string" &&
    sourceName.length > 0 &&
    typeof sourceTable === "string" &&
    sourceTable.length > 0
  ) {
    if (containsSourceCall(body.text, sourceName, sourceTable)) {
      return true;
    }
  }

  return false;
}

function containsRefCall(body: string, name: string, pkg?: string): boolean {
  const e = escapeRegex;
  const simple = new RegExp(`ref\\s*\\(\\s*['"]${e(name)}['"]\\s*[,)]`);
  if (simple.test(body)) {
    return true;
  }
  if (pkg) {
    const qualified = new RegExp(
      `ref\\s*\\(\\s*['"]${e(pkg)}['"]\\s*,\\s*['"]${e(name)}['"]\\s*[,)]`,
    );
    if (qualified.test(body)) {
      return true;
    }
  }
  return false;
}

function containsSourceCall(
  body: string,
  sourceName: string,
  tableName: string,
): boolean {
  const e = escapeRegex;
  const re = new RegExp(
    `source\\s*\\(\\s*['"]${e(sourceName)}['"]\\s*,\\s*['"]${e(tableName)}['"]\\s*\\)`,
  );
  return re.test(body);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -----------------------------------------------------------------------------
// Key builders
// -----------------------------------------------------------------------------

function refKey(
  name: string,
  pkg?: string | null,
  version?: string | number | null,
): string {
  const p = pkg ?? "";
  const v =
    version === undefined || version === null || version === ""
      ? ""
      : String(version);
  return `${p}::${name}::${v}`;
}

function sourceKey(sourceName: string, tableName: string): string {
  return `${sourceName}::${tableName}`;
}
