import type { LayeredGraph } from "../layering.js";

/**
 * The state the ordering searches: each rank's nodes from left to right, and the segments that link each node to the
 * ranks above and below. `layers` is the only part a search changes; `index` follows it.
 */
export interface OrderModel {
  readonly graph: LayeredGraph;
  /** Layered node indices per rank, left to right. */
  readonly layers: number[][];
  /** Each node's index in its rank. */
  readonly index: number[];
  /** Segments whose upper end is the node: its links to the rank below. */
  readonly down: number[][];
  /** Segments whose lower end is the node: its links to the rank above. */
  readonly up: number[][];
}

/** Share of a node's breadth a port's offset may move a link, so the position stays inside the node's span. */
const PORT_SHARE = 0.9;

/** An ordering state with `layers` as its order, indexed and linked to `graph`'s segments. */
export function createModel(
  graph: LayeredGraph,
  layers: number[][],
): OrderModel {
  const down: number[][] = graph.nodes.map(() => []);
  const up: number[][] = graph.nodes.map(() => []);
  graph.segments.forEach((s, si) => {
    down[s.top]!.push(si);
    up[s.bottom]!.push(si);
  });
  const model: OrderModel = {
    graph,
    layers,
    index: graph.nodes.map(() => 0),
    down,
    up,
  };
  layers.forEach((layer) => reindex(model, layer));
  return model;
}

/** Replaces the order of one rank and updates the indices of its nodes. */
export function setLayer(model: OrderModel, rank: number, order: number[]): void {
  model.layers[rank] = order;
  reindex(model, order);
}

/** The in-rank position of a link's end at `node`: its index, moved by the port offset as a share of its breadth. */
export function slot(model: OrderModel, node: number, offset: number): number {
  const breadth = Math.max(1, model.graph.nodes[node]!.breadth);
  return model.index[node]! + (offset / breadth) * PORT_SHARE;
}

function reindex(model: OrderModel, order: readonly number[]): void {
  order.forEach((x, k) => {
    model.index[x] = k;
  });
}
