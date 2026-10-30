import type {
  LayoutCluster,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
} from "./types.js";

/**
 * The input, indexed once per run: the id maps and per-node lookups the phases used to build for themselves. An
 * `Indexed` is a `LayoutGraph` with the maps added, so a phase takes it wherever it takes the graph.
 */
export interface Indexed extends LayoutGraph {
  /** The index in `nodes` of each node, by id. */
  readonly nodeIndex: ReadonlyMap<string, number>;
  readonly nodeById: ReadonlyMap<string, LayoutNode>;
  readonly edgeById: ReadonlyMap<string, LayoutEdge>;
  /** The index in `clusters` of each cluster, by id. */
  readonly clusterIndex: ReadonlyMap<string, number>;
  /** The parent of each cluster, by cluster id; `undefined` for a top-level cluster. */
  readonly clusterParent: ReadonlyMap<string, LayoutCluster["parent"]>;
  /** The innermost cluster of each node, by node id; `undefined` for a node in no cluster. */
  readonly innermost: ReadonlyMap<string, string | undefined>;
}

/** The objects `indexed` has built, so that a phase given one of them returns it unchanged. */
const built = new WeakSet<LayoutGraph>();

/**
 * `graph` indexed. An `Indexed` input is returned as it is, so a phase can call this on the input it was given and
 * get the maps `runPhases` built; any other graph is indexed afresh.
 */
export function indexed(graph: LayoutGraph): Indexed {
  if (built.has(graph)) {
    return graph as Indexed;
  }
  const clusters = graph.clusters ?? [];
  const out: Indexed = {
    ...graph,
    nodeIndex: new Map(graph.nodes.map((node, i) => [node.id, i] as const)),
    nodeById: new Map(graph.nodes.map((node) => [node.id, node] as const)),
    edgeById: new Map(graph.edges.map((edge) => [edge.id, edge] as const)),
    clusterIndex: new Map(clusters.map((c, i) => [c.id, i] as const)),
    clusterParent: new Map(clusters.map((c) => [c.id, c.parent] as const)),
    innermost: new Map(
      graph.nodes.map((node) => [node.id, node.cluster] as const),
    ),
  };
  built.add(out);
  return out;
}
