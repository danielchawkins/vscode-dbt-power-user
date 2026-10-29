import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { caseArb, routeGraph, routeOptions } from "../testing/routeGraphs.js";
import type { LayoutEdge, LayoutNode, Point, Side } from "../types.js";

/** A node and its centre in the drawing. */
interface Placed {
  node: LayoutNode;
  centre: Point;
}

/**
 * Where a routed end sits. A port on a side lateral to the flow sits on that side, at its offset along it. Otherwise the
 * end sits on the box face toward the band below (`towardLower`) or above it, at the port's offset along that face when
 * the port is on it, else at the face's centre.
 */
function endAt(
  end: { placed: Placed; port: string | undefined; towardLower: boolean },
  down: boolean,
): Point {
  const { node, centre } = end.placed;
  const at = node.ports?.find((p) => p.id === end.port);
  const lateral: Side[] = down ? ["east", "west"] : ["south", "north"];
  if (at !== undefined && lateral.includes(at.side)) {
    const beyond = at.side === lateral[0] ? 1 : -1;
    return down
      ? {
          x: centre.x + (beyond * node.width) / 2,
          y: centre.y - node.height / 2 + at.offset,
        }
      : {
          x: centre.x - node.width / 2 + at.offset,
          y: centre.y + (beyond * node.height) / 2,
        };
  }
  const sign = end.towardLower ? 1 : -1;
  const sides: { lower: Side; upper: Side } = down
    ? { lower: "south", upper: "north" }
    : { lower: "east", upper: "west" };
  const side: Side = end.towardLower ? sides.lower : sides.upper;
  const breadth = down ? node.width : node.height;
  const mid = down ? centre.x : centre.y;
  const across = at?.side === side ? mid - breadth / 2 + at.offset : mid;
  const rank = down
    ? centre.y + (sign * node.height) / 2
    : centre.x + (sign * node.width) / 2;
  return down ? { x: across, y: rank } : { x: rank, y: across };
}

/** The two ends a routed edge starts and ends at. A flat edge's ends both face the band below their rank. */
function endsOf({
  edge,
  source,
  target,
  down,
}: {
  edge: LayoutEdge;
  source: Placed;
  target: Placed;
  down: boolean;
}): [Point, Point] {
  const rankOf = (p: Point) => (down ? p.y : p.x);
  const flat = rankOf(source.centre) === rankOf(target.centre);
  const sourceLower = flat || rankOf(source.centre) < rankOf(target.centre);
  return [
    endAt(
      { placed: source, port: edge.sourcePort, towardLower: sourceLower },
      down,
    ),
    endAt(
      {
        placed: target,
        port: edge.targetPort,
        towardLower: flat || !sourceLower,
      },
      down,
    ),
  ];
}

/** Asserts that a polyline end is at the expected point. */
function expectAt(actual: Point | undefined, want: Point): void {
  expect(actual?.x).toBeCloseTo(want.x, 6);
  expect(actual?.y).toBeCloseTo(want.y, 6);
}

describe("route ports", () => {
  it("draws each routed edge as an orthogonal polyline from its source node to its target node", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, {
          ...routeOptions,
          direction,
          effort,
        });
        const down = direction === "down";
        const placed = (id: string): Placed | undefined => {
          const node = graph.nodes.find((n) => n.id === id);
          const centre = routing.nodes.get(id);
          return node && centre ? { node, centre } : undefined;
        };
        for (const edge of graph.edges) {
          const path = routing.edges.get(edge.id);
          if (edge.kind === "fk" || edge.source === edge.target) {
            expect(path).toBeUndefined();
            continue;
          }
          expect(path).toBeDefined();
          const points = path ?? [];
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            expect(a?.x === b?.x || a?.y === b?.y).toBe(true);
          }
          const s = placed(edge.source);
          const t = placed(edge.target);
          expect(s !== undefined && t !== undefined).toBe(true);
          if (s && t) {
            const [a, b] = endsOf({ edge, source: s, target: t, down });
            expectAt(points[0], a);
            expectAt(points.at(-1), b);
          }
        }
      }),
    );
  });
});
