import type {
  LayoutCluster,
  LayoutGraph,
  LayoutInputIssue,
  LayoutOptions,
} from "./types.js";

/** Port ids by node id. */
type PortsByNode = ReadonlyMap<string, ReadonlySet<string>>;

const isSize = (size: number): boolean => Number.isFinite(size) && size > 0;

function nodeIssues(
  graph: LayoutGraph,
  issues: LayoutInputIssue[],
): PortsByNode {
  const nodes = new Map<string, ReadonlySet<string>>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) {
      issues.push({ code: "duplicate-id", subject: node.id });
    }
    if (!isSize(node.width) || !isSize(node.height)) {
      issues.push({ code: "bad-size", subject: node.id });
    }
    const ports = new Set<string>();
    for (const port of node.ports ?? []) {
      if (ports.has(port.id)) {
        issues.push({ code: "duplicate-id", subject: `${node.id}.${port.id}` });
      }
      ports.add(port.id);
    }
    nodes.set(node.id, ports);
  }
  return nodes;
}

/** Whether following `parent` from `cluster` comes back to a cluster already passed. */
function inCycle(
  cluster: LayoutCluster,
  byId: ReadonlyMap<string, LayoutCluster>,
): boolean {
  const passed = new Set<string>();
  for (
    let at: string | undefined = cluster.id;
    at !== undefined;
    at = byId.get(at)?.parent
  ) {
    if (passed.has(at)) {
      return true;
    }
    passed.add(at);
  }
  return false;
}

function clusterIssues(graph: LayoutGraph, issues: LayoutInputIssue[]): void {
  const byId = new Map<string, LayoutCluster>();
  for (const cluster of graph.clusters ?? []) {
    if (byId.has(cluster.id)) {
      issues.push({ code: "duplicate-id", subject: cluster.id });
    }
    byId.set(cluster.id, cluster);
  }
  for (const cluster of byId.values()) {
    if (cluster.parent !== undefined && !byId.has(cluster.parent)) {
      issues.push({ code: "unknown-cluster", subject: cluster.id });
    }
    if (inCycle(cluster, byId)) {
      issues.push({ code: "cluster-cycle", subject: cluster.id });
    }
  }
  for (const node of graph.nodes) {
    if (node.cluster !== undefined && !byId.has(node.cluster)) {
      issues.push({ code: "unknown-cluster", subject: node.id });
    }
  }
}

function edgeIssues(
  graph: LayoutGraph,
  context: {
    kinds: LayoutOptions["edgeKinds"];
    nodes: PortsByNode;
    issues: LayoutInputIssue[];
  },
): void {
  const { kinds, nodes, issues } = context;
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (seen.has(edge.id)) {
      issues.push({ code: "duplicate-id", subject: edge.id });
    }
    seen.add(edge.id);
    if (!Object.hasOwn(kinds, edge.kind)) {
      issues.push({ code: "unknown-kind", subject: edge.id });
    }
    for (const [end, port] of [
      [edge.source, edge.sourcePort],
      [edge.target, edge.targetPort],
    ] as const) {
      const ports = nodes.get(end);
      if (!ports) {
        issues.push({ code: "unknown-node", subject: edge.id });
      } else if (port !== undefined && !ports.has(port)) {
        issues.push({ code: "unknown-port", subject: edge.id });
      }
    }
  }
}

/**
 * Every problem `layout` would refuse in `graph` under `options`: duplicate ids, edges to unknown nodes, ports or
 * kinds, members of unknown clusters, cluster cycles, and sizes that are not finite and positive. Empty when the
 * input is valid. A consumer calls it to report bad input itself; `layout` calls it first and throws on any issue.
 */
export function validateGraph(
  graph: LayoutGraph,
  options: Pick<LayoutOptions, "edgeKinds">,
): LayoutInputIssue[] {
  const issues: LayoutInputIssue[] = [];
  const nodes = nodeIssues(graph, issues);
  clusterIssues(graph, issues);
  edgeIssues(graph, { kinds: options.edgeKinds, nodes, issues });
  return issues;
}
