import { lateralPort } from "./lateral.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "./types.js";

/**
 * The non-self-loop edges, grouped by kind and ordered pair of nodes, in order of first appearance. A port on a side
 * lateral to the flow also keys its group, so each such port gets a bundle of its own and its own port dummy.
 */
export function groupBundles(
  graph: LayoutGraph,
  direction: LayoutOptions["direction"],
): LayoutEdge[][] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const lateral = (id: string, port: string | undefined): string | undefined =>
    lateralPort(nodes.get(id), port, direction) === undefined
      ? undefined
      : port;
  const groups = new Map<string, LayoutEdge[]>();
  for (const e of graph.edges) {
    if (e.source === e.target) {
      continue;
    }
    const key = JSON.stringify([
      e.kind,
      e.source,
      e.target,
      lateral(e.source, e.sourcePort),
      lateral(e.target, e.targetPort),
    ]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [e]);
    } else {
      group.push(e);
    }
  }
  return [...groups.values()];
}
