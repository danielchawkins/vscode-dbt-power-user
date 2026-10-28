import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { order } from "../order/index.js";
import { place } from "../place/index.js";
import { rank } from "../rank/index.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Point,
  Side,
} from "../types.js";
import { type Routing, route } from "./index.js";

const KINDS = ["dependency", "column", "fk"] as const;
const SIDES: readonly Side[] = ["north", "east", "south", "west"];

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
    fk: { ranks: false, weight: 0.5, routed: false },
  },
};

const portArb = fc.record({
  side: fc.constantFrom(...SIDES),
  offset: fc.integer({ min: 0, max: 20 }),
});

const nodeArb = fc.record({
  width: fc.integer({ min: 20, max: 120 }),
  height: fc.integer({ min: 20, max: 80 }),
  ports: fc.tuple(portArb, portArb),
});

const portName = fc.option(fc.constantFrom("p0", "p1"), { nil: undefined });

/** Nodes and edges with no self-loops, ports on some edges, and a kind that is not routed. */
const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 2, max: 9 })
  .chain((count) =>
    fc.tuple(
      fc.array(nodeArb, { minLength: count, maxLength: count }),
      fc.array(
        fc.tuple(
          fc.nat(count - 1),
          fc.nat(count - 1),
          fc.nat(KINDS.length - 1),
          portName,
          portName,
        ),
        { maxLength: 18 },
      ),
    ),
  )
  .map(([nodes, specs]) => ({
    nodes: nodes.map((n, i): LayoutNode => ({
      id: `n${i}`,
      width: n.width,
      height: n.height,
      ports: n.ports.map((p, k) => ({ id: `p${k}`, ...p })),
    })),
    edges: specs.map(([a, b, k, sp, tp], i): LayoutEdge => {
      const target = a === b ? (a + 1) % nodes.length : b;
      return {
        id: `e${i}`,
        source: `n${a}`,
        target: `n${target}`,
        kind: KINDS[k] ?? "dependency",
        ...(sp === undefined ? {} : { sourcePort: sp }),
        ...(tp === undefined ? {} : { targetPort: tp }),
      };
    }),
  }));

const caseArb = fc.record({
  graph: graphArb,
  direction: fc.constantFrom("down" as const, "right" as const),
  effort: fc.constantFrom("fast" as const, "balanced" as const),
});

/** Runs the layout phases up to routing. */
function routeGraph(graph: LayoutGraph, opts: LayoutOptions): Routing {
  const ordering = order(graph, opts, rank(graph, opts));
  return route(graph, opts, {
    ordering,
    placement: place(graph, opts, ordering),
  });
}

/** A node and its centre in the drawing. */
interface Placed {
  node: LayoutNode;
  centre: Point;
}

/**
 * Where a routed end sits: on the box face toward the band below (`towardLower`) or above it, at the port's offset along
 * that face when the port is on it, else at the face's centre.
 */
function endAt(
  end: { placed: Placed; port: string | undefined; towardLower: boolean },
  down: boolean,
): Point {
  const { node, centre } = end.placed;
  const sign = end.towardLower ? 1 : -1;
  const sides = down
    ? { lower: "south", upper: "north" }
    : { lower: "east", upper: "west" };
  const side: Side = end.towardLower ? sides.lower : sides.upper;
  const at = node.ports?.find((p) => p.id === end.port);
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
        const routing = routeGraph(graph, { ...options, direction, effort });
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
