import type { LayoutGraph, LayoutOptions } from "../types.js";

// Test-only: a ten-node layered graph in five partitions, each partition also a cluster, whose dependency edges rank
// it and whose relation edges are routed but do not rank. Its shape is a lineage view: two sources, three staging
// nodes, one hub, three outputs and one unrelated node. The relation edges make crossings the order has to trade.

export const bandedGraph: LayoutGraph = {
  nodes: [
    { id: "n0", width: 280, height: 65, partition: 0, cluster: "c0" },
    { id: "n1", width: 280, height: 65, partition: 0, cluster: "c0" },
    { id: "n2", width: 280, height: 65, partition: 1, cluster: "c1" },
    { id: "n3", width: 280, height: 65, partition: 1, cluster: "c1" },
    { id: "n4", width: 280, height: 65, partition: 1, cluster: "c1" },
    { id: "n5", width: 280, height: 109, partition: 2, cluster: "c2" },
    { id: "n6", width: 280, height: 65, partition: 3, cluster: "c3" },
    { id: "n7", width: 280, height: 65, partition: 3, cluster: "c3" },
    { id: "n8", width: 280, height: 65, partition: 3, cluster: "c3" },
    { id: "n9", width: 280, height: 65, partition: 4, cluster: "c4" },
  ],
  edges: [
    { id: "e0", source: "n0", target: "n2", kind: "dependency" },
    { id: "e1", source: "n2", target: "n5", kind: "dependency" },
    { id: "e2", source: "n1", target: "n5", kind: "dependency" },
    { id: "e3", source: "n3", target: "n5", kind: "dependency" },
    { id: "e4", source: "n4", target: "n5", kind: "dependency" },
    { id: "e5", source: "n5", target: "n7", kind: "dependency" },
    { id: "e6", source: "n5", target: "n6", kind: "dependency" },
    { id: "e7", source: "n5", target: "n8", kind: "dependency" },
    { id: "e8", source: "n6", target: "n7", kind: "dependency" },
    { id: "e9", source: "n0", target: "n5", kind: "dependency" },
    { id: "e10", source: "n4", target: "n8", kind: "dependency" },
    { id: "e11", source: "n0", target: "n4", kind: "relation" },
    { id: "e12", source: "n3", target: "n4", kind: "relation" },
    { id: "e13", source: "n5", target: "n6", kind: "relation" },
    { id: "e14", source: "n7", target: "n6", kind: "relation" },
    { id: "e15", source: "n8", target: "n1", kind: "relation" },
  ],
  clusters: ["c0", "c1", "c2", "c3", "c4"].map((id) => ({ id, padding: 22 })),
};

/** The options the graph is laid out with: rows, soft partitions, the hub as anchor. */
export const bandedOptions: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true },
    relation: { ranks: false },
  },
  partitions: "soft",
  ranks: "rows",
  anchor: "n5",
  spacing: { node: 28, rank: 36, edge: 6, cluster: 28 },
};
