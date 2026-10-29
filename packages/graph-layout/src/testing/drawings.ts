import type { Drawing, DrawnPath } from "../metrics.js";
import type { Routing } from "../route/index.js";
import type { LayoutGraph, Rect } from "../types.js";

// Test-only: the drawing measureDrawing reads, built from a routing of `graph`.

/** The drawing measureDrawing reads: node boxes, routed polylines, and the source port as each edge's trunk. */
export function drawingOf(
  graph: LayoutGraph,
  routing: Pick<Routing, "nodes" | "edges">,
): Drawing {
  const edges = new Map(graph.edges.map((e) => [e.id, e] as const));
  const boxes = new Map<string, Rect>();
  for (const node of graph.nodes) {
    const c = routing.nodes.get(node.id);
    if (c !== undefined) {
      boxes.set(node.id, {
        x: c.x - node.width / 2,
        y: c.y - node.height / 2,
        width: node.width,
        height: node.height,
      });
    }
  }
  const paths = new Map<string, DrawnPath>();
  for (const [id, points] of routing.edges) {
    const edge = edges.get(id);
    if (edge !== undefined) {
      paths.set(id, { points, source: edge.source, target: edge.target });
    }
  }
  const trunkOf = (id: string) => {
    const edge = edges.get(id);
    return edge?.sourcePort === undefined
      ? undefined
      : `${edge.source}:${edge.sourcePort}`;
  };
  return { boxes, paths, trunkOf };
}
