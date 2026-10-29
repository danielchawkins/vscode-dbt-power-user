import type { LayoutGraph } from "./types.js";

/**
 * The cluster chain of a cluster: the clusters that contain it, outermost first, as indices into `graph.clusters`. The
 * chain ends with the cluster itself.
 */
export function chainOf(graph: LayoutGraph, cluster: string): number[] {
  const clusters = graph.clusters ?? [];
  const number = new Map(clusters.map((c, i) => [c.id, i] as const));
  const parent = new Map(clusters.map((c) => [c.id, c.parent] as const));
  const chain: number[] = [];
  for (
    let id: string | undefined = cluster;
    id !== undefined;
    id = parent.get(id)
  ) {
    const n = number.get(id);
    if (n !== undefined) {
      chain.unshift(n);
    }
  }
  return chain;
}

/**
 * The cluster chain of each entry: the clusters that contain its owner, outermost first, as indices into
 * `graph.clusters`. `owners` gives each entry's owning node id, or `undefined` for a dummy, which has no chain. A node
 * in a nested cluster has the chain of every ancestor cluster as well as its own.
 */
export function clusterChains(
  graph: LayoutGraph,
  owners: readonly (string | undefined)[],
): number[][] {
  const innermost = new Map(graph.nodes.map((n) => [n.id, n.cluster] as const));
  const chains = new Map<string, number[]>();
  return owners.map((owner) => {
    const cluster = owner === undefined ? undefined : innermost.get(owner);
    if (cluster === undefined) {
      return [];
    }
    let chain = chains.get(cluster);
    if (chain === undefined) {
      chain = chainOf(graph, cluster);
      chains.set(cluster, chain);
    }
    return chain;
  });
}
