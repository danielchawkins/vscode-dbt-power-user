/** Which producer fills a field of the merged manifest at Fusion 2.0.6 (parse rows: `docs/lsp-metadata-gaps.md`). */
export type FieldOwner = "server" | "parse";

/** The producer of each merged field; tests check it against the merge and the gaps document. */
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

export type Field = keyof typeof FIELD_OWNERS;

/** The fields `FIELD_OWNERS` assigns to `owner`. */
export function fieldsOwnedBy(owner: FieldOwner): Field[] {
  return (Object.keys(FIELD_OWNERS) as Field[]).filter(
    (field) => FIELD_OWNERS[field] === owner,
  );
}
