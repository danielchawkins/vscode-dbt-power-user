import type { lineage } from "@fusion-power-user/webview-contract";

type LineageTable = lineage.LineageTable;

/** Neighbours that share a bucket, and the neighbours in no bucket; both in display order. */
export interface Buckets {
  /** Buckets of two or more undrawn neighbours, each with its members' IDs. */
  buckets: { key: string; members: string[] }[];
  /** Undrawn neighbours that are alone in their bucket. */
  loose: string[];
}

/** An expansion's buckets, and which of them are open; an open bucket's members are drawn. */
export type NeighbourGroups = Buckets & { open: Record<string, boolean> };

/** The IDs a grouped expansion draws: its loose neighbours, then the members of each open bucket. */
export const groupedNeighbours = (groups: NeighbourGroups): string[] => [
  ...groups.loose,
  ...groups.buckets
    .filter((bucket) => groups.open[bucket.key])
    .flatMap((bucket) => bucket.members),
];

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
