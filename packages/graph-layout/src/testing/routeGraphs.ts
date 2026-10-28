import fc from "fast-check";
import { order } from "../order/index.js";
import { place } from "../place/index.js";
import { rank } from "../rank/index.js";
import { type Routing, route } from "../route/index.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Side,
} from "../types.js";

// Test-only: random graphs and the layout phases up to routing, shared by the route test files.

const KINDS = ["dependency", "column", "fk"] as const;
const SIDES: readonly Side[] = ["north", "east", "south", "west"];

export const routeOptions: LayoutOptions = {
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
const routeGraphArb: fc.Arbitrary<LayoutGraph> = fc
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

export const caseArb = fc.record({
  graph: routeGraphArb,
  direction: fc.constantFrom("down" as const, "right" as const),
  effort: fc.constantFrom("fast" as const, "balanced" as const),
});

/** Runs the layout phases up to routing. */
export function routeGraph(graph: LayoutGraph, opts: LayoutOptions): Routing {
  const ordering = order(graph, opts, rank(graph, opts));
  return route(graph, opts, {
    ordering,
    placement: place(graph, opts, ordering),
  });
}
