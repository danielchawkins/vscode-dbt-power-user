import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LayoutGraph, Point, Rect } from "../types.js";
import { caseArb, options, routeGraph } from "./testGraphs.js";

/** Whether an axis-parallel segment passes through the open interior of a box. A segment along an edge does not. */
function entersBox(a: Point, b: Point, box: Rect): boolean {
  return (
    Math.min(a.x, b.x) < box.x + box.width &&
    Math.max(a.x, b.x) > box.x &&
    Math.min(a.y, b.y) < box.y + box.height &&
    Math.max(a.y, b.y) > box.y
  );
}

/** The box of each real node, from its centre in the routing. */
function boxesOf(graph: LayoutGraph, centres: ReadonlyMap<string, Point>) {
  return new Map(
    graph.nodes.flatMap((node) => {
      const c = centres.get(node.id);
      return c === undefined
        ? []
        : [
            [
              node.id,
              {
                x: c.x - node.width / 2,
                y: c.y - node.height / 2,
                width: node.width,
                height: node.height,
              },
            ] as const,
          ];
    }),
  );
}

describe("route lateral ports", () => {
  it("keeps every edge out of the interior of the nodes it starts and ends at, so a lateral stub never crosses its own node", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, { ...options, direction, effort });
        const boxes = boxesOf(graph, routing.nodes);
        for (const edge of graph.edges) {
          const path = routing.edges.get(edge.id) ?? [];
          const own = [edge.source, edge.target].map((id) => boxes.get(id));
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1];
            const b = path[i];
            for (const box of own) {
              expect(box !== undefined && entersBox(a, b, box)).toBe(false);
            }
          }
        }
      }),
    );
  });
});
