import { measureDrawing } from "./metrics.js";
import type { OrderResult } from "./order/index.js";
import type { LayoutPhases } from "./phases.js";
import type {
  EdgeLayout,
  LayoutEdge,
  LayoutGraph,
  LayoutHints,
  LayoutMetrics,
  LayoutOptions,
  LayoutResult,
  NodeLayout,
  Point,
  Rect,
} from "./types.js";

/** The top-left and bottom-right corners of a rectangle. */
function cornersOf(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ];
}

/** The smallest rectangle holding every point; an empty rectangle at the origin when there are none. */
function hullOf(points: readonly Point[]): Rect {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Each real node's rank, and its index among the real nodes of that rank. Dummies are not counted. */
function slotsOf(
  ordering: OrderResult,
): Map<string, { rank: number; order: number }> {
  const slots = new Map<string, { rank: number; order: number }>();
  for (const members of ordering.layers) {
    let order = 0;
    for (const x of members) {
      const node = ordering.layered.nodes[x]!;
      if (node.id !== undefined) {
        slots.set(node.id, { rank: node.rank, order });
        order += 1;
      }
    }
  }
  return slots;
}

/** The rectangle of each real node: its routed centre, minus half its size. */
function nodeRects(
  graph: LayoutGraph,
  phases: LayoutPhases,
): Map<string, NodeLayout> {
  const slots = slotsOf(phases.ordering);
  return new Map(
    graph.nodes.map((node) => {
      const centre = phases.routing.nodes.get(node.id)!;
      const slot = slots.get(node.id)!;
      const layout: NodeLayout = {
        x: centre.x - node.width / 2,
        y: centre.y - node.height / 2,
        width: node.width,
        height: node.height,
        rank: slot.rank,
        order: slot.order,
      };
      return [node.id, layout];
    }),
  );
}

/** One box per partition that some node sets, spanning the rectangles of its members; none when `partitions` is `none`. */
function partitionBoxes(
  graph: LayoutGraph,
  nodes: ReadonlyMap<string, Rect>,
  options: LayoutOptions,
): LayoutResult["partitions"] {
  if (options.partitions === "none") {
    return [];
  }
  const members = new Map<number, Point[]>();
  for (const node of graph.nodes) {
    if (node.partition !== undefined) {
      const corners = members.get(node.partition) ?? [];
      corners.push(...cornersOf(nodes.get(node.id)!));
      members.set(node.partition, corners);
    }
  }
  return [...members]
    .sort(([a], [b]) => a - b)
    .map(([partition, corners]) => ({ partition, ...hullOf(corners) }));
}

/** Each edge's polyline, with whether ranking reversed it. Only routed edges have a polyline. */
function edgeLayouts(phases: LayoutPhases): Map<string, EdgeLayout> {
  const reversed = new Set(phases.ranking.reversed);
  return new Map(
    Array.from(phases.routing.edges, ([id, points]) => [
      id,
      { points, reversed: reversed.has(id) },
    ]),
  );
}

/** The trunk of an edge is its source port; an edge with no source port has none. */
function trunkOf(graph: LayoutGraph): (edge: string) => string | undefined {
  const byId = new Map(graph.edges.map((edge) => [edge.id, edge] as const));
  return (id) => {
    const edge = byId.get(id);
    return edge?.sourcePort === undefined
      ? undefined
      : JSON.stringify([edge.source, edge.sourcePort]);
  };
}

/** The metrics of the drawing the node rectangles and edge polylines make. */
function metricsOf(
  graph: LayoutGraph,
  nodes: ReadonlyMap<string, NodeLayout>,
  edges: ReadonlyMap<string, EdgeLayout>,
): LayoutMetrics {
  const byId = new Map<string, LayoutEdge>(
    graph.edges.map((edge) => [edge.id, edge]),
  );
  return measureDrawing({
    boxes: nodes,
    paths: new Map(
      Array.from(edges, ([id, edge]) => {
        const { source, target } = byId.get(id)!;
        return [id, { points: edge.points, source, target }];
      }),
    ),
    trunkOf: trunkOf(graph),
  });
}

/** Assembles the public result from the phases' output. Nothing here runs a phase or changes its output. */
export function resultOf(
  graph: LayoutGraph,
  options: LayoutOptions,
  phases: LayoutPhases,
): LayoutResult {
  const nodes = nodeRects(graph, phases);
  const edges = edgeLayouts(phases);
  const clusters = phases.routing.clusters;
  const points: Point[] = [
    ...[...nodes.values()].flatMap(cornersOf),
    ...[...clusters.values()].flatMap(cornersOf),
    ...[...edges.values()].flatMap((edge) => edge.points),
  ];
  const hints: LayoutHints = {
    nodes: new Map(
      Array.from(nodes, ([id, n]) => [
        id,
        { rank: n.rank, order: n.order, x: n.x, y: n.y },
      ]),
    ),
  };
  return {
    nodes,
    edges,
    clusters,
    partitions: partitionBoxes(graph, nodes, options),
    bounds: hullOf(points),
    hints,
    metrics: metricsOf(graph, nodes, edges),
  };
}
