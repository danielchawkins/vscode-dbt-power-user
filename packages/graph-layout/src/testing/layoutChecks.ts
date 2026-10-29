import type { Drawing } from "../metrics.js";
import { runPhases } from "../phases.js";
import type {
  LayoutGraph,
  LayoutOptions,
  LayoutResult,
  Point,
  Rect,
} from "../types.js";
import { routeOptions } from "./routeGraphs.js";

// Test-only: independent checks of a `layout` result, shared by the layout test files.

/** Slack for the rounding the solvers leave in coordinates. */
export const EPS = 1e-6;

/** A test case: a graph, with the direction and effort it is laid out at. */
export interface Case {
  graph: LayoutGraph;
  direction: "down" | "right";
  effort: "fast" | "balanced";
}

export const RANKS = ["rows", "levels"] as const;
export type Ranks = (typeof RANKS)[number];

/** The options a case is laid out with under `ranks`, with partitions soft and any extra options. */
export function optionsOf(
  c: Case,
  ranks: Ranks,
  extra: Partial<LayoutOptions> = {},
): LayoutOptions {
  return {
    ...routeOptions,
    direction: c.direction,
    effort: c.effort,
    ranks,
    partitions: "soft",
    ...extra,
  };
}

export const centreOf = (r: Rect): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** Whether two rectangles share interior area. Touching edges do not count. */
export function overlapping(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.height - EPS &&
    b.y < a.y + a.height - EPS
  );
}

/** Whether a point lies on the boundary of a rectangle: on one of its sides, and within the rectangle. */
export function onBoundary(p: Point, r: Rect): boolean {
  const inside =
    p.x >= r.x - EPS &&
    p.x <= r.x + r.width + EPS &&
    p.y >= r.y - EPS &&
    p.y <= r.y + r.height + EPS;
  const onSide =
    Math.abs(p.x - r.x) < EPS ||
    Math.abs(p.x - (r.x + r.width)) < EPS ||
    Math.abs(p.y - r.y) < EPS ||
    Math.abs(p.y - (r.y + r.height)) < EPS;
  return inside && onSide;
}

/** The layered order of a graph: each layer as real node ids, dummies as `#<index>`. */
export function layeredOrder(
  graph: LayoutGraph,
  options: LayoutOptions,
): string[][] {
  const { ordering } = runPhases(graph, options);
  return ordering.layers.map((layer) =>
    layer.map((x) => ordering.layered.nodes[x].id ?? `#${x}`),
  );
}

/** Largest move of any node's top-left corner between two results. */
export function maxMove(a: LayoutResult, b: LayoutResult): number {
  let most = 0;
  for (const [id, n] of a.nodes) {
    const m = b.nodes.get(id)!;
    most = Math.max(most, Math.abs(n.x - m.x), Math.abs(n.y - m.y));
  }
  return most;
}

/**
 * The drawing a result makes, rebuilt from its public fields alone: each edge trunks on its source port, and an edge
 * with no source port has no trunk.
 */
export function drawingOf(graph: LayoutGraph, result: LayoutResult): Drawing {
  const byId = new Map(graph.edges.map((e) => [e.id, e] as const));
  return {
    boxes: result.nodes,
    paths: new Map(
      Array.from(result.edges, ([id, edge]) => {
        const e = byId.get(id)!;
        return [
          id,
          { points: edge.points, source: e.source, target: e.target },
        ] as const;
      }),
    ),
    trunkOf: (id) => {
      const e = byId.get(id)!;
      return e.sourcePort === undefined
        ? undefined
        : `${e.source}\u0000${e.sourcePort}`;
    },
  };
}
