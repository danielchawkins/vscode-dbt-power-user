import { chainOf } from "./clusters.js";
import { byThenIndex } from "./comparators.js";
import type { DummyKey } from "./layeredGraph.js";
import type { LayoutGraph } from "./types.js";

/**
 * A gap in a cluster's spine: two of its layered nodes, more than one rank apart, with no member of the cluster in
 * the ranks between. A dummy goes in each of those ranks, so that the cluster has a member in every rank it spans.
 */
export interface Spine {
  /** The cluster whose spine this is. */
  cluster: string;
  /** Layered index of the member in the upper rank, and of the member in the lower one. */
  upper: number;
  lower: number;
  /** Rank of each dummy the gap needs, from the upper rank down. */
  ranks: number[];
  /** Cluster chain of the cluster the gap belongs to: the cluster and its ancestors. */
  chain: number[];
}

/** The part of a layered node that a spine dummy needs. */
interface PlacedNode {
  id: string | undefined;
  rank: number;
  breadth: number;
  key?: DummyKey;
}

/**
 * The gaps of every cluster's spine. `ranks` gives each layered node's rank, and `paths` its cluster chain. For each
 * cluster, its members are taken in rank order, and each pair of neighbours more than one rank apart is a gap.
 */
export function spinesOf(
  graph: LayoutGraph,
  ranks: readonly number[],
  paths: readonly (readonly number[])[],
): Spine[] {
  return (graph.clusters ?? []).flatMap((cluster, c) => {
    const members = ranks.flatMap((_, x) => (paths[x]?.includes(c) ? [x] : []));
    members.sort(byThenIndex<number>([(x) => ranks[x]!], (x) => x));
    const chain = chainOf(graph, cluster.id);
    return members.slice(1).flatMap((lower, k) => {
      const upper = members[k]!;
      const top = ranks[upper]!;
      const gap = ranks[lower]! - top;
      return gap > 1
        ? [
            {
              cluster: cluster.id,
              upper,
              lower,
              ranks: Array.from({ length: gap - 1 }, (_, i) => top + 1 + i),
              chain,
            },
          ]
        : [];
    });
  });
}

/**
 * Appends a dummy for each rank of each gap to `nodes`. Returns each spine as the layered indices it runs through, from
 * the upper member down to the lower one, and the cluster chain of each appended dummy, in the same order.
 */
export function addSpineDummies(
  nodes: PlacedNode[],
  spines: readonly Spine[],
): { spines: number[][]; paths: number[][] } {
  const paths: number[][] = [];
  const runs = spines.map((spine) => {
    const run = [spine.upper];
    spine.ranks.forEach((rank, k) => {
      const key: DummyKey = {
        kind: "cluster",
        owner: spine.cluster,
        rank,
        position: k + 1,
      };
      run.push(nodes.push({ id: undefined, rank, breadth: 0, key }) - 1);
      paths.push(spine.chain);
    });
    return [...run, spine.lower];
  });
  return { spines: runs, paths };
}
