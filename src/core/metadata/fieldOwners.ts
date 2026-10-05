/**
 * Which producer fills a field of the merged manifest at Fusion 2.0.6 (parse rows: `docs/lsp-metadata-gaps.md`).
 * @internal
 */
export type FieldOwner = "server" | "parse";

/** @internal */
export const FIELD_OWNERS = {
  nodes: "server",
  "graphMetaMap.parents": "server",
  "graphMetaMap.children": "server",
  modelDepthMap: "server",
  nodeMetaMap: "parse",
  sourceMetaMap: "parse",
  "graphMetaMap.tests": "parse",
  "graphMetaMap.metrics": "parse",
  testMetaMap: "parse",
  macroMetaMap: "parse",
  docMetaMap: "parse",
  metricMetaMap: "parse",
  semanticModelMetaMap: "parse",
  exposureMetaMap: "parse",
  unitTestMetaMap: "parse",
  functionMetaMap: "parse",
} as const satisfies Readonly<Record<string, FieldOwner>>;

/** @internal */
export type Field = keyof typeof FIELD_OWNERS;

/** How the merge treats one server resource type. */
interface TypePolicy {
  /** The server's listing of the root package is authoritative: unlisted parse nodes of this type are dropped. */
  replace: boolean;
  /** A node the server lists and the parse lacks is added, with identity only. */
  add: boolean;
  /** The type has a key in `graphMetaMap.parents`. */
  parentKey: boolean;
  /** The type is a node of the graph. */
  graph: boolean;
}

const node = (
  replace: boolean,
  add: boolean,
  parentKey: boolean,
  graph = true,
): TypePolicy => ({ replace, add, parentKey, graph });

/** Resource types whose node set the server owns (`dbt.listNodes ["+package:<root>"]`), and how the merge treats each. */
const MERGE_POLICY: Readonly<Record<string, TypePolicy>> = {
  model: node(true, true, true),
  seed: node(true, true, true),
  snapshot: node(true, true, true),
  exposure: node(true, false, true),
  function: node(true, false, true),
  source: node(false, false, false),
  test: node(false, false, true),
  unit_test: node(false, false, false, false),
};

export const SERVER_RESOURCE_TYPES: ReadonlySet<string> = new Set(
  Object.keys(MERGE_POLICY),
);

const typesWhere = (flag: keyof TypePolicy): ReadonlySet<string> =>
  new Set(
    Object.entries(MERGE_POLICY)
      .filter(([, policy]) => policy[flag])
      .map(([type]) => type),
  );

/** Server types whose unlisted parse nodes of the root package are dropped. */
export const REPLACED_TYPES = typesWhere("replace");
/** Server types added to the parse when it lacks them. */
export const ADDED_TYPES = typesWhere("add");
/** Server types with a key in `graphMetaMap.parents`. */
export const SERVER_PARENT_KEY_TYPES = typesWhere("parentKey");
/** Server types that are nodes of the graph. */
export const SERVER_GRAPH_TYPES = typesWhere("graph");

/** @internal */
export function fieldsOwnedBy(owner: FieldOwner): Field[] {
  return (Object.keys(FIELD_OWNERS) as Field[]).filter(
    (field) => FIELD_OWNERS[field] === owner,
  );
}
