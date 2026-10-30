import type {
  LayoutCluster,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
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
  /**
   * The component of each node, by node id. Components are the connected parts of the nodes joined by the edges that
   * rank or are routed, numbered from zero in the order of their first node in `nodes`.
   */
  readonly component: ReadonlyMap<string, number>;
}

/** The objects `indexed` has built, so that a phase given one of them returns it unchanged. */
const built = new WeakSet<LayoutGraph>();

/**
 * `graph` indexed. An `Indexed` input is returned as it is, so a phase can call this on the input it was given and
 * get the maps `runPhases` built; any other graph is indexed afresh. The components use the edge kinds' policies in
 * `options`, when they are given: without them, every edge joins its ends.
 */
export function indexed(
  graph: LayoutGraph,
  options?: Pick<LayoutOptions, "edgeKinds">,
): Indexed {
  if (built.has(graph)) {
    return graph as Indexed;
  }
  const clusters = graph.clusters ?? [];
  const nodeIndex = new Map(
    graph.nodes.map((node, i) => [node.id, i] as const),
  );
  const out: Indexed = {
    ...graph,
    nodeIndex,
    nodeById: new Map(graph.nodes.map((node) => [node.id, node] as const)),
    edgeById: new Map(graph.edges.map((edge) => [edge.id, edge] as const)),
    clusterIndex: new Map(clusters.map((c, i) => [c.id, i] as const)),
    clusterParent: new Map(clusters.map((c) => [c.id, c.parent] as const)),
    innermost: new Map(
      graph.nodes.map((node) => [node.id, node.cluster] as const),
    ),
    component: componentsOf(graph, nodeIndex, options),
  };
  built.add(out);
  return out;
}

/** Whether an edge joins its ends for the components: its kind ranks, or it is routed. */
function joins(
  edge: LayoutEdge,
  options: Pick<LayoutOptions, "edgeKinds"> | undefined,
): boolean {
  if (options === undefined) {
    return true;
  }
  const policy = options.edgeKinds[edge.kind];
  return policy?.ranks === true || policy?.routed !== false;
}

/**
 * The component of each node, by union-find over the joining edges. Each root is the smallest index of its component,
 * so the components are numbered in the order of their first node.
 */
function componentsOf(
  graph: LayoutGraph,
  nodeIndex: ReadonlyMap<string, number>,
  options: Pick<LayoutOptions, "edgeKinds"> | undefined,
): Map<string, number> {
  const parent = graph.nodes.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r]!;
    }
    return r;
  };
  for (const edge of graph.edges) {
    const a = nodeIndex.get(edge.source);
    const b = nodeIndex.get(edge.target);
    if (a === undefined || b === undefined || !joins(edge, options)) {
      continue;
    }
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) {
      parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const ids = new Map<number, number>();
  return new Map(
    graph.nodes.map((node, i) => {
      const r = root(i);
      if (!ids.has(r)) {
        ids.set(r, ids.size);
      }
      return [node.id, ids.get(r)!] as const;
    }),
  );
}
