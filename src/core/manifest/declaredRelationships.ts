import type { Log } from "../log";
import type { RelationIndex } from "./relationIndex";
import { resolveBaseName } from "./relationIndex";
import { isIgnoredByMeta } from "./relationshipInference";
import type { Meta, NodeMetaMap, Ref, SourceMetaMap } from "./types";

/** What a declaration needs besides its own text. */
interface DeclaredContext {
  index: RelationIndex;
  terminal: Pick<Log, "debug">;
}

/** `source('source_name', 'table')`, with both arguments captured. */
export const SOURCE_PATTERN =
  /^source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/;
const SINGLE_REF_PATTERN = /^ref\(\s*['"]([^'"]+)['"]\s*\)$/;

/**
 * The refs declared in `meta.relationships` on every node and source table. The declaring node or table is the
 * `from` side; see `RelationshipParser.fromMeta` for the convention.
 */
export function declaredRefs(
  nodeMetaMap: NodeMetaMap,
  sourceMetaMap: SourceMetaMap | undefined,
  context: DeclaredContext,
): Ref[] {
  const refs: Ref[] = [];
  for (const node of nodeMetaMap.nodes()) {
    refs.push(
      ...refsOf(
        { owner: node.unique_id, package_name: node.package_name },
        declaredValue(node.meta, node.config?.meta),
        context,
      ),
    );
  }
  for (const source of sourceMetaMap?.values() ?? []) {
    for (const table of source.tables ?? []) {
      refs.push(
        ...refsOf(
          { owner: table.unique_id, package_name: source.package_name },
          declaredValue(table.meta, table.configMeta),
          context,
        ),
      );
    }
  }
  context.terminal.debug(
    "RelationshipParser",
    `Derived ${refs.length} refs from meta.relationships`,
  );
  return refs;
}

/** The raw `relationships` value of an owner; `ignore_in_erd` on its own meta drops it. */
function declaredValue(meta: Meta, configMeta: Meta): unknown {
  if (isIgnoredByMeta(meta)) {
    return undefined;
  }
  return meta?.relationships ?? configMeta?.relationships;
}

/** The declaring node or table, and the package its `ref()` names resolve from. */
interface Owner {
  owner: string;
  package_name: string;
}

function refsOf(
  site: Owner,
  declared: unknown,
  context: DeclaredContext,
): Ref[] {
  const { owner } = site;
  if (declared === undefined || declared === null) {
    return [];
  }
  if (!Array.isArray(declared)) {
    context.terminal.debug(
      "RelationshipParser",
      `Skipping meta.relationships on ${owner}: not a list`,
    );
    return [];
  }
  const refs: Ref[] = [];
  declared.forEach((entry: unknown, position: number) => {
    const ref = refFromDeclaration({ ...site, position }, entry, context);
    if (ref) {
      refs.push(ref);
    }
  });
  return refs;
}

function refFromDeclaration(
  site: Owner & { position: number },
  entry: unknown,
  context: DeclaredContext,
): Ref | undefined {
  const skip = (reason: string): undefined => {
    context.terminal.debug(
      "RelationshipParser",
      `Skipping meta.relationships[${site.position}] on ${site.owner}: ${reason}`,
    );
    return undefined;
  };
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return skip("not a mapping");
  }
  const declaration = entry as Record<string, unknown>;
  if ("cases" in declaration || "to_schema" in declaration) {
    return skip("cases and to_schema are not supported");
  }
  const fromColumns = stringList(declaration.from_columns);
  const toColumns = stringList(declaration.to_columns);
  if (!fromColumns || !toColumns || fromColumns.length !== toColumns.length) {
    return skip(
      "from_columns and to_columns must be non-empty lists of equal length",
    );
  }
  const to = declaration.to;
  if (typeof to !== "string") {
    return skip("to must be a string");
  }
  const toTable = resolveDeclaredTo(to, site.package_name, context.index);
  if (!toTable) {
    return skip(`cannot resolve ${to} to one node or source table`);
  }
  return {
    id: `meta:${site.owner}[${site.position}]`,
    from: { table: site.owner, columns: fromColumns },
    to: { table: toTable, columns: toColumns },
    cardinality: "many-to-one",
    source: "meta",
  };
}

/**
 * Resolve a `meta.relationships` `to` to a unique_id. `ref('name')` with one argument resolves through
 * `resolveBaseName`: the declaring package's own node, then the latest version, otherwise nothing.
 * `source('source_name', 'table')` resolves to its table, or to nothing when more than one source table claims
 * that `source_name.table` key.
 */
function resolveDeclaredTo(
  to: string,
  fromPackage: string,
  index: RelationIndex,
): string | undefined {
  const trimmed = to.trim();
  const refMatch = SINGLE_REF_PATTERN.exec(trimmed);
  if (refMatch) {
    return resolveBaseName(index, refMatch[1] ?? "", fromPackage);
  }
  const sourceMatch = SOURCE_PATTERN.exec(trimmed);
  if (sourceMatch) {
    const key = `${sourceMatch[1]}.${sourceMatch[2]}`;
    return index.ambiguousSourceTables.has(key)
      ? undefined
      : index.bySourceTable.get(key);
  }
  return undefined;
}

/** The value as a non-empty list of non-empty strings, or `undefined`. */
function stringList(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v) => typeof v === "string" && v.length > 0)
  ) {
    return undefined;
  }
  return value as string[];
}
