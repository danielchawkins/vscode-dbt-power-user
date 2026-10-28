import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Drawing, type DrawnPath, measureDrawing } from "../metrics.js";
import { order } from "../order/index.js";
import { place } from "../place/index.js";
import { rank } from "../rank/index.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Rect,
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

/** The drawing measureDrawing reads: node boxes, routed polylines, and the source port as each edge's trunk. */
function drawingOf(graph: LayoutGraph, routing: Routing): Drawing {
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

describe("route", () => {
  it("leaves node boxes apart, and no polyline through a node it does not end at", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, { ...options, direction, effort });
        expect(measureDrawing(drawingOf(graph, routing)).overlaps).toBe(0);
      }),
    );
  });

  it("counts the same crossings in its bands as measureDrawing counts over the drawing", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, { ...options, direction, effort });
        const metrics = measureDrawing(drawingOf(graph, routing));
        expect(routing.work.capped).toBe(false);
        expect(routing.work.crossings).toBe(metrics.crossings);
      }),
    );
  });

  it("is a pure function of its input, with an anchor kept at the origin", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const anchor = graph.nodes[0]?.id;
        const opts: LayoutOptions = {
          ...options,
          direction,
          effort,
          ...(anchor === undefined ? {} : { anchor }),
        };
        const first = routeGraph(graph, opts);
        expect(serialise(routeGraph(graph, opts))).toEqual(serialise(first));
        if (anchor !== undefined) {
          expect(first.nodes.get(anchor)).toEqual({ x: 0, y: 0 });
        }
      }),
    );
  });

  it("routes a 300-node graph with no overlaps and the crossings measured", () => {
    const graph = seededGraph(300, 900);
    const routing = routeGraph(graph, { ...options, effort: "fast" });
    const metrics = measureDrawing(drawingOf(graph, routing));
    expect(metrics.overlaps).toBe(0);
    expect(routing.work.crossings).toBe(metrics.crossings);
  }, 120_000);
});

/** A graph from a fixed linear congruential sequence, so the test has no randomness. */
function seededGraph(count: number, edgeCount: number): LayoutGraph {
  let state = 12345;
  const next = (n: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
  const nodes: LayoutNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    width: 40 + next(60),
    height: 30 + next(30),
  }));
  const edges: LayoutEdge[] = Array.from({ length: edgeCount }, (_, i) => {
    const a = next(count);
    const b = (a + 1 + next(count - 1)) % count;
    return {
      id: `e${i}`,
      source: `n${a}`,
      target: `n${b}`,
      kind: "dependency",
    };
  });
  return { nodes, edges };
}

function serialise(routing: Routing): string {
  return JSON.stringify({
    nodes: [...routing.nodes],
    edges: [...routing.edges],
    work: routing.work,
  });
}
