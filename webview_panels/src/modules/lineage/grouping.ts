import type { lineage } from "@fusion-power-user/webview-contract";

type LineageTable = lineage.LineageTable;

/** Neighbours that share a bucket, and the neighbours in no bucket; both in display order. */
export interface Buckets {
  /** Buckets of two or more undrawn neighbours, each with its members' IDs. */
  buckets: { key: string; members: string[] }[];
  /** Undrawn neighbours that are alone in their bucket. */
  loose: string[];
}

/**
 * An expansion's buckets, and how many members of each are drawn: `open[key]` is the count, and a bucket without an
 * entry (or with 0) is closed.
 */
export type NeighbourGroups = Buckets & { open: Record<string, number> };

/** The IDs a grouped expansion draws: its loose neighbours, then the first `open` members of each open bucket. */
export const groupedNeighbours = (groups: NeighbourGroups): string[] => [
  ...groups.loose,
  ...groups.buckets.flatMap((bucket) =>
    bucket.members.slice(0, groups.open[bucket.key] ?? 0),
  ),
];

/** The label of a bucket key: its last folder segment, or the resource type of a `type:` key. */
export const groupLabel = (key: string): string => {
  if (key.startsWith("type:")) {
    return key.slice("type:".length);
  }
  const folder = key.startsWith("pkg:") ? key.slice("pkg:".length) : key;
  const last = folder.split("/").at(-1) ?? "";
  return last === "" ? "(root)" : last;
};

/** The node ID of a closed bucket `key` of the expansion `expansion`, so a group never shares a table's ID. */
export const groupNodeId = (expansion: string, key: string): string =>
  `group:${expansion}|${key}`;

/**
 * The expansion key and bucket key a group node ID was made from, or undefined for any other ID. An expansion key
 * has no `|`, so the first one ends it; a bucket key may hold any other character.
 */
export function parseGroupNodeId(
  id: string,
): [expansion: string, key: string] | undefined {
  if (!id.startsWith("group:")) {
    return undefined;
  }
  const body = id.slice("group:".length);
  const bar = body.indexOf("|");
  if (bar <= 0) {
    return undefined;
  }
  return [body.slice(0, bar), body.slice(bar + 1)];
}

/**
 * The bucket of a node: its folder, `pkg:<folder>` outside the root package, or `type:<nodeType>` when it has no
 * path. A file at the root of a package has an empty folder.
 */
const bucketKey = (table: LineageTable): string => {
  if (!table.path) {
    return `type:${table.nodeType}`;
  }
  const folder = table.path.split("/").slice(0, -1).join("/");
  return table.rootPackage ? folder : `pkg:${folder}`;
};

const LAYERS = ["staging", "intermediate", "marts"];

/** Sorts a layer: the named layers first, then other layers by name, then nodes with no layer. */
const layerRank = (layer: string | undefined): [number, string] => {
  if (!layer) {
    return [LAYERS.length + 1, ""];
  }
  const index = LAYERS.indexOf(layer);
  return index >= 0 ? [index, ""] : [LAYERS.length, layer];
};

const byLayerThenName = (a: LineageTable, b: LineageTable): number => {
  const [rankA, otherA] = layerRank(a.layer);
  const [rankB, otherB] = layerRank(b.layer);
  return (
    rankA - rankB ||
    otherA.localeCompare(otherB) ||
    (a.refName ?? a.label).localeCompare(b.refName ?? b.label)
  );
};

/**
 * Buckets the undrawn `neighbours` by folder. A bucket of one becomes loose, and so does a neighbour in no bucket.
 * Returns undefined when the buckets and loose neighbours together would not fit in `cap`.
 */
export function bucketNeighbours(
  neighbours: readonly LineageTable[],
  drawn: ReadonlySet<string>,
  cap: number,
): Buckets | undefined {
  const undrawn = neighbours
    .filter((n) => !drawn.has(n.table))
    .toSorted(byLayerThenName);
  const byKey = Map.groupBy(undrawn, bucketKey);
  const buckets = [...byKey]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({
      key,
      members: members.map((m) => m.table),
    }));
  const loose = undrawn
    .filter((n) => (byKey.get(bucketKey(n))?.length ?? 0) < 2)
    .map((n) => n.table);
  return buckets.length + loose.length > cap ? undefined : { buckets, loose };
}
