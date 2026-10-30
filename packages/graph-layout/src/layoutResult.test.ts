import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layout } from "./layout.js";
import { measureDrawing } from "./metrics.js";
import { runPhases } from "./phases.js";
import { caseArb as boxCaseArb } from "./testing/boxes.js";
import { type Case, EPS, optionsOf, RANKS } from "./testing/layoutChecks.js";
import {
  caseArb as routeCaseArb,
  routeOptions,
} from "./testing/routeGraphs.js";
import type {
  LayoutGraph,
  LayoutOptions,
  LayoutResult,
  Rect,
} from "./types.js";

const RUNS = 60;
const SUITES = [
  ["route", routeCaseArb],
  ["clustered", boxCaseArb],
] as const;

/** The partitions a graph's nodes may be given: none, or one of three. */
const partitionedArb = fc
  .tuple(
    routeCaseArb,
    fc.array(fc.option(fc.nat({ max: 2 }), { nil: undefined }), {
      minLength: 9,
      maxLength: 9,
    }),
  )
  .map(([c, parts]) => ({
    ...c,
    graph: {
      ...c.graph,
      nodes: c.graph.nodes.map((n, i) => {
        const partition = parts[i];
        return partition === undefined ? n : { ...n, partition };
      }),
    },
  }));

/** The hull of rectangles, as the bounding box of their corners. */
function hullOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Every point a result draws: node and cluster corners, and each edge's points. */
function drawnPoints(result: LayoutResult): { x: number; y: number }[] {
  return [
    ...[...result.nodes.values(), ...result.clusters.values()].flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ]),
    ...[...result.edges.values()].flatMap((e) => e.points),
  ];
}

describe.each(SUITES)("layout result on %s graphs", (suite, arb) => {
  describe("rows", () => {
    it("has no overlaps", () => {
      fc.assert(
        fc.property(arb, (c: Case) => {
          const result = layout(c.graph, optionsOf(c, "rows"));
          expect(result.metrics.overlaps).toBe(0);
        }),
        { numRuns: RUNS },
      );
    });
  });

  describe("levels", () => {
    it("has no node-node overlaps", () => {
      fc.assert(
        fc.property(arb, (c: Case) => {
          const result = layout(c.graph, optionsOf(c, "levels"));
          expect(
            measureDrawing({ boxes: result.nodes, paths: new Map() }).overlaps,
          ).toBe(0);
        }),
        { numRuns: RUNS },
      );
    });
  });

  for (const ranks of RANKS) {
    describe(`ranks ${ranks}`, () => {
      it("reports each edge's reversed flag as ranking reversed it", () => {
        fc.assert(
          fc.property(arb, (c: Case) => {
            const o = optionsOf(c, ranks);
            const reversed = new Set(runPhases(c.graph, o).ranking.reversed);
            const result = layout(c.graph, o);
            for (const [id, edge] of result.edges) {
              expect(edge.reversed).toBe(reversed.has(id));
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("has an entry for every routed edge: drawn, or flagged routeFailed when it is a self-loop", () => {
        fc.assert(
          fc.property(arb, (c: Case) => {
            const first = c.graph.nodes[0].id;
            const graph: LayoutGraph = {
              ...c.graph,
              edges: [
                ...c.graph.edges,
                {
                  id: "self",
                  source: first,
                  target: first,
                  kind: "dependency",
                },
              ],
            };
            const o = optionsOf(c, ranks);
            const expected = graph.edges
              .filter((e) => o.edgeKinds[e.kind]?.routed !== false)
              .map((e) => e.id)
              .sort((a, b) => a.localeCompare(b));
            const result = layout(graph, o).edges;
            const ids = [...result.keys()].sort((a, b) => a.localeCompare(b));
            expect(ids).toEqual(expected);
            for (const [id, edge] of result) {
              expect(edge.routeFailed).toBe(
                id === "self" || edge.points.length === 0,
              );
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("bounds every node, cluster and edge point, and touches each side", () => {
        fc.assert(
          fc.property(arb, (c: Case) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            const points = drawnPoints(result);
            const b = result.bounds;
            for (const p of points) {
              expect(p.x).toBeGreaterThanOrEqual(b.x - EPS);
              expect(p.x).toBeLessThanOrEqual(b.x + b.width + EPS);
              expect(p.y).toBeGreaterThanOrEqual(b.y - EPS);
              expect(p.y).toBeLessThanOrEqual(b.y + b.height + EPS);
            }
            const xs = points.map((p) => p.x);
            const ys = points.map((p) => p.y);
            expect(Math.min(...xs)).toBeCloseTo(b.x, 5);
            expect(Math.min(...ys)).toBeCloseTo(b.y, 5);
            expect(Math.max(...xs)).toBeCloseTo(b.x + b.width, 5);
            expect(Math.max(...ys)).toBeCloseTo(b.y + b.height, 5);
          }),
          { numRuns: RUNS },
        );
      });

      it("keeps the hints as each node's rank, order and top-left corner", () => {
        fc.assert(
          fc.property(arb, (c: Case) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            expect(result.hints.nodes.size).toBe(c.graph.nodes.length);
            for (const [id, n] of result.nodes) {
              expect(result.hints.nodes.get(id)).toEqual({
                rank: n.rank,
                order: n.order,
                x: n.x,
                y: n.y,
              });
            }
          }),
          { numRuns: RUNS },
        );
      });
    });
  }
});

describe("partitions", () => {
  it("is empty when partitions is none", () => {
    fc.assert(
      fc.property(partitionedArb, (c: Case) => {
        const o = optionsOf(c, "rows", { partitions: "none" });
        expect(layout(c.graph, o).partitions).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  it("boxes each partition present by the hull of its members", () => {
    fc.assert(
      fc.property(partitionedArb, (c: Case) => {
        for (const ranks of RANKS) {
          const result = layout(c.graph, optionsOf(c, ranks));
          const present = [
            ...new Set(
              c.graph.nodes
                .map((n) => n.partition)
                .filter((p) => p !== undefined),
            ),
          ].sort((a, b) => a - b);
          expect(result.partitions.map((p) => p.partition)).toEqual(present);
          for (const box of result.partitions) {
            const members = c.graph.nodes
              .filter((n) => n.partition === box.partition)
              .map((n) => result.nodes.get(n.id)!);
            const hull = hullOf(members);
            expect(hull.x).toBeCloseTo(box.x, 5);
            expect(hull.y).toBeCloseTo(box.y, 5);
            expect(hull.width).toBeCloseTo(box.width, 5);
            expect(hull.height).toBeCloseTo(box.height, 5);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe("documented limitations", () => {
  it("documents the levels limitation: a run can pass through a node it does not end at", () => {
    // Counted over a fixed sample, so the count is reproducible. The test asserts the limitation is still there: when
    // the routing stops passing through nodes, this fails and the README line must go.
    let edgeNode = 0;
    let nodeNode = 0;
    fc.assert(
      fc.property(routeCaseArb, (c: Case) => {
        const result = layout(c.graph, optionsOf(c, "levels"));
        const nodesOnly = measureDrawing({
          boxes: result.nodes,
          paths: new Map(),
        }).overlaps;
        nodeNode += nodesOnly;
        edgeNode += result.metrics.overlaps - nodesOnly;
        return true;
      }),
      { numRuns: 100, seed: 11 },
    );
    expect(nodeNode).toBe(0);
    expect(edgeNode).toBeGreaterThan(0);
  });

  it("documents the clustered limitation: feeding hints can move a clustered node's order", () => {
    const members: [string, string][] = [
      ["n0", "c0"],
      ["n1", "c1"],
      ["n2", "c0"],
      ["n3", "c0"],
      ["n4", "c1"],
      ["n5", "c2"],
      ["n6", "c0"],
      ["n7", "c2"],
    ];
    const graph: LayoutGraph = {
      nodes: members.map(([id, cluster]) => ({
        id,
        width: 80,
        height: 40,
        cluster,
      })),
      edges: [{ id: "e0", source: "n0", target: "n5", kind: "dependency" }],
      clusters: ["c0", "c1", "c2"].map((id) => ({
        id,
        padding: 0,
        labelHeight: 0,
      })),
    };
    const o: LayoutOptions = {
      ...routeOptions,
      direction: "down",
      effort: "fast",
    };
    const first = layout(graph, o);
    const again = layout(graph, { ...o, hints: first.hints });
    const moved = [...first.nodes.keys()].filter(
      (id) => again.nodes.get(id)!.order !== first.nodes.get(id)!.order,
    );
    expect(moved.length).toBeGreaterThan(0);
  });
});

describe("hints", () => {
  it("keeps the order when a long edge's dummies must move together to repeat it", () => {
    // A long edge runs from n2 to n3 past n1 and n4. Re-seeded from the hints, its dummies start on the other side of
    // the real nodes, and no single dummy move lowers the crossings, so sifting alone kept a worse order and the hinted
    // search swapped n0 and n3. The unhinted search is now a candidate, and it finds the original order.
    const port = (id: string, side: "north" | "east") => ({
      id,
      side,
      offset: 0,
    });
    const graph: LayoutGraph = {
      nodes: ["n0", "n1", "n2", "n3", "n4"].map((id) => ({
        id,
        width: 20,
        height: 20,
        ports: [
          port("p0", "north"),
          port("p1", id === "n2" ? "east" : "north"),
        ],
      })),
      edges: [
        {
          id: "e0",
          source: "n2",
          target: "n3",
          kind: "column",
          sourcePort: "p1",
          targetPort: "p0",
        },
        {
          id: "e1",
          source: "n2",
          target: "n1",
          kind: "dependency",
          sourcePort: "p1",
        },
        {
          id: "e2",
          source: "n1",
          target: "n4",
          kind: "dependency",
          targetPort: "p0",
        },
        { id: "e3", source: "n4", target: "n0", kind: "dependency" },
      ],
    };
    const o: LayoutOptions = {
      ...routeOptions,
      direction: "right",
      effort: "fast",
      ranks: "levels",
      partitions: "soft",
    };
    const first = layout(graph, o);
    const again = layout(graph, { ...o, hints: first.hints });
    for (const [id, node] of first.nodes) {
      expect(again.nodes.get(id)!.order, id).toBe(node.order);
    }
  });
});
