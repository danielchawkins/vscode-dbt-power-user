// The layering inputs shared by the parity tooling: the ported scope of a graph, the case line that the Rust layering
// check reads (print-fixtures.mjs prints it), and the synthetic graphs of the layering timings
// (scripts/bench/layering-timings.mjs). Both callers build the same graphs by the same path. Contributor tooling only;
// it ships nothing.
//
// `rank` and `layer` are passed in, not imported: the callers register the TypeScript resolve hook first, and this
// module loads before it is needed.

export const csv = (xs) => (xs.length > 0 ? xs.map(String).join(",") : "-");

/** The IEEE 754 bits of `x` as 16 lowercase hex digits, so that -0 and every ulp survive the print (`String` drops -0). */
export function bitsHex(x) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

export const bitsCsv = (xs) =>
  xs.length > 0 ? xs.map(bitsHex).join(",") : "-";

/** The options of the lineage graph: table edges rank, bands are soft. Used for the finance graph and the synthetic DAG. */
export const LINEAGE_OPTIONS = {
  direction: "down",
  edgeKinds: { table: { ranks: true } },
  partitions: "soft",
};

/**
 * The ported scope of layering: the nodes with their partition and the edges with their kind. Ports and clusters are
 * left out, since their chains (lateral, cluster and spine) are later phases.
 */
export function portedScope(graph) {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      ...(node.partition === undefined ? {} : { partition: node.partition }),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
    })),
  };
}

/**
 * One layering case, from `rank` and `layer` on the ported scope. Tab-separated fields: `case`, the name, the partition
 * mode, the band of each node (bits, or `-` for none), the edges as `s:t:kind:ranks:minLength:weight` joined by `;`
 * (kind is the dense index by first appearance), the rank of each node (bits, comma-separated), the reversed edge
 * indices, and the chain of each bundle joined by `;`: a chain is comma-separated nodes `n<index>` or dummies
 * `d<owner>:<rank>:<position>`, with the owner an edge index.
 */
/**
 * Each edge of a ported scope as `source:target:kind:ranks:minLength:weight`, with the node indices of the scope, the
 * kind numbered in order of first appearance, and the policy of the kind (or the defaults). Shared by the layering and
 * ordering fixtures, so both read the same input.
 */
export function edgeRules(scope, options) {
  const nodeIndex = new Map(scope.nodes.map((node, i) => [node.id, i]));
  const kinds = new Map();
  return scope.edges.map((edge) => {
    if (!kinds.has(edge.kind)) {
      kinds.set(edge.kind, kinds.size);
    }
    const policy = options.edgeKinds[edge.kind];
    return [
      nodeIndex.get(edge.source),
      nodeIndex.get(edge.target),
      kinds.get(edge.kind),
      policy?.ranks ? 1 : 0,
      String(policy?.minLength ?? 1),
      String(policy?.weight ?? 1),
    ].join(":");
  });
}

export function layeringLine(name, graph, { options, rank, layer }) {
  const scope = portedScope(graph);
  const nodeIndex = new Map(scope.nodes.map((node, i) => [node.id, i]));
  const edgeIndex = new Map(scope.edges.map((edge, i) => [edge.id, i]));
  const edges = edgeRules(scope, options);
  const ranking = rank(scope, options);
  const layered = layer(scope, options, ranking);
  const token = (x) => {
    const node = layered.nodes[x];
    if (node.id !== undefined) {
      return `n${nodeIndex.get(node.id)}`;
    }
    return `d${edgeIndex.get(node.key.owner)}:${node.key.rank}:${node.key.position}`;
  };
  const chains = layered.bundles.map((bundle) =>
    bundle.chain.map(token).join(","),
  );
  return [
    "case",
    name,
    options.partitions ?? "soft",
    scope.nodes
      .map((node) =>
        node.partition === undefined ? "-" : bitsHex(node.partition),
      )
      .join(","),
    edges.length > 0 ? edges.join(";") : "-",
    bitsCsv(scope.nodes.map((node) => ranking.ranks.get(node.id))),
    csv(ranking.reversed.map((id) => edgeIndex.get(id))),
    chains.length > 0 ? chains.join(";") : "-",
  ].join("\t");
}

/**
 * A seeded DAG of `count` nodes, drawn from `random` (a seeded generator in [0, 1)): each node is in one of three bands,
 * or in none (one in five), and each node after the first takes one to three parents among the nodes before it, so the
 * graph is acyclic and every edge is of kind `table`.
 */
export function syntheticDag(count, random) {
  const nodes = Array.from({ length: count }, (_, i) => {
    const band = random() < 0.2 ? undefined : Math.floor(random() * 3);
    return {
      id: `n${i}`,
      width: 60,
      height: 30,
      ...(band === undefined ? {} : { partition: band }),
    };
  });
  const edges = [];
  for (let i = 1; i < count; i++) {
    const parents = 1 + Math.floor(random() * 3);
    for (let k = 0; k < parents; k++) {
      const parent = Math.floor(random() * i);
      edges.push({
        id: `e${edges.length}`,
        source: `n${parent}`,
        target: `n${i}`,
        kind: "table",
      });
    }
  }
  return { nodes, edges };
}
