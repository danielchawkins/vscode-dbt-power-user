import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Drawing, type DrawnPath, measureDrawing } from "../metrics.js";
import { caseArb, routeGraph, routeOptions } from "../testing/routeGraphs.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Point,
  Rect,
  Side,
} from "../types.js";
import { type Routing } from "./index.js";

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
        const routing = routeGraph(graph, {
          ...routeOptions,
          direction,
          effort,
        });
        expect(measureDrawing(drawingOf(graph, routing)).overlaps).toBe(0);
      }),
    );
  });

  it("counts the same crossings in its bands as measureDrawing counts over the drawing", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, {
          ...routeOptions,
          direction,
          effort,
        });
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
          ...routeOptions,
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

  it("never lays two polylines with no end node in common along one line, unless they swap ends", () => {
    fc.assert(
      fc.property(caseArb, ({ graph, direction, effort }) => {
        const routing = routeGraph(graph, {
          ...routeOptions,
          direction,
          effort,
        });
        const across: Axis = direction === "down" ? "x" : "y";
        const ends = new Map<string, readonly string[]>(
          graph.edges.map((e) => [e.id, [e.source, e.target]] as const),
        );
        const runs = Array.from(routing.edges, ([id, points]) => ({
          id,
          points,
          ends: ends.get(id) ?? [],
        }));
        const overlaps: string[] = [];
        for (const [i, p] of runs.entries()) {
          for (const q of runs.slice(i + 1)) {
            const shared = p.ends.some((n) => q.ends.includes(n));
            if (
              !shared &&
              !swapsEnds(p.points, q.points, across) &&
              longestOverlap(p.points, q.points) > EPS
            ) {
              overlaps.push(`${p.id} ${q.id}`);
            }
          }
        }
        expect(overlaps).toEqual([]);
      }),
    );
  });

  it("counts the crossing of a jog over a straight run that shares a star", () => {
    // n3's p1 feeds n0 twice and e1 runs straight down from n0: e3's jog crosses e1, which shares e0's star.
    const ports = (a: Side, b: Side) => [
      { id: "p0", side: a, offset: 0 },
      { id: "p1", side: b, offset: 0 },
    ];
    const graph: LayoutGraph = {
      nodes: [
        { id: "n0", width: 20, height: 20, ports: ports("north", "east") },
        { id: "n1", width: 20, height: 20, ports: ports("west", "north") },
        { id: "n2", width: 20, height: 20, ports: ports("north", "east") },
        { id: "n3", width: 20, height: 20, ports: ports("east", "north") },
      ],
      edges: [
        {
          id: "e0",
          source: "n3",
          target: "n0",
          kind: "column",
          sourcePort: "p1",
        },
        { id: "e1", source: "n0", target: "n1", kind: "dependency" },
        {
          id: "e2",
          source: "n3",
          target: "n1",
          kind: "dependency",
          sourcePort: "p0",
          targetPort: "p0",
        },
        {
          id: "e3",
          source: "n3",
          target: "n0",
          kind: "column",
          sourcePort: "p1",
          targetPort: "p1",
        },
      ],
    };
    const routing = routeGraph(graph, {
      ...routeOptions,
      direction: "down",
      effort: "fast",
    });
    expect(routing.work.crossings).toBe(
      measureDrawing(drawingOf(graph, routing)).crossings,
    );
  });

  it("routes a 300-node graph with no overlaps and the crossings measured", () => {
    const graph = seededGraph(300, 900);
    const routing = routeGraph(graph, { ...routeOptions, effort: "fast" });
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

/** Lengths below this are floating-point noise, not an overlap. */
const EPS = 1e-6;

type Axis = "x" | "y";

interface Segment {
  from: Point;
  to: Point;
}

function segmentsOf(points: readonly Point[]): Segment[] {
  return points.slice(1).flatMap((to, i) => {
    const from = points[i];
    return from ? [{ from, to }] : [];
  });
}

/** The axis a segment runs along, or undefined when it is a point. */
function axisOf(s: Segment): Axis | undefined {
  if (s.from.y === s.to.y && s.from.x !== s.to.x) {
    return "x";
  }
  if (s.from.x === s.to.x && s.from.y !== s.to.y) {
    return "y";
  }
  return undefined;
}

/** The length two segments share on one line; zero unless both run along the same axis on the same coordinate. */
function alongOverlap(a: Segment, b: Segment): number {
  const axis = axisOf(a);
  if (axis === undefined || axis !== axisOf(b)) {
    return 0;
  }
  const across: Axis = axis === "x" ? "y" : "x";
  if (a.from[across] !== b.from[across]) {
    return 0;
  }
  const lo = Math.max(
    Math.min(a.from[axis], a.to[axis]),
    Math.min(b.from[axis], b.to[axis]),
  );
  const hi = Math.min(
    Math.max(a.from[axis], a.to[axis]),
    Math.max(b.from[axis], b.to[axis]),
  );
  return hi - lo;
}

/** The longest stretch along which a segment of one polyline lies on a segment of the other. */
function longestOverlap(p: readonly Point[], q: readonly Point[]): number {
  let best = 0;
  for (const a of segmentsOf(p)) {
    for (const b of segmentsOf(q)) {
      best = Math.max(best, alongOverlap(a, b));
    }
  }
  return best;
}

/**
 * Whether two polylines end at the same two across-positions in swapped order. No track order or jog separates such a
 * pair without trading the overlap for a crossing, so the overlap property excuses it.
 */
function swapsEnds(
  p: readonly Point[],
  q: readonly Point[],
  across: Axis,
): boolean {
  const pe = endsAcross(p, across);
  const qe = endsAcross(q, across);
  if (!pe || !qe) {
    return false;
  }
  const [a, b] = pe;
  const [c, d] = qe;
  return a !== b && ((a === c && b === d) || (a === d && b === c));
}

/** The across-coordinates of a polyline's two ends. */
function endsAcross(
  points: readonly Point[],
  across: Axis,
): [number, number] | undefined {
  const first = points[0];
  const last = points.at(-1);
  return first && last ? [first[across], last[across]] : undefined;
}
