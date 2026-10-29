import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layout, LayoutInputError } from "./layout.js";
import { measureDrawing } from "./metrics.js";
import { caseArb as boxCaseArb, boxViolations } from "./testing/boxes.js";
import {
  centreOf,
  drawingOf,
  EPS,
  layeredOrder,
  maxMove,
  onBoundary,
  optionsOf,
  orderingCrossings,
  overlapping,
  RANKS,
} from "./testing/layoutChecks.js";
import { caseArb as routeCaseArb } from "./testing/routeGraphs.js";
import type { LayoutGraph } from "./types.js";
import { validateGraph } from "./validate.js";

const RUNS = 60;
/**
 * The round trip moves a node no further than this many smallest node extents, when the layered order repeats.
 * See README "Hints".
 */
const HINT_MOVE_EXTENTS = 2;

/** The suites: route graphs (ports, a kind that is not routed) and clustered graphs. */
const SUITES = [
  ["route", routeCaseArb],
  ["clustered", boxCaseArb],
] as const;

describe.each(SUITES)("layout on %s graphs", (suite, arb) => {
  for (const ranks of RANKS) {
    describe(`ranks ${ranks}`, () => {
      it("is deterministic", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const o = optionsOf(c, ranks);
            expect(layout(c.graph, o)).toEqual(layout(c.graph, o));
          }),
          { numRuns: RUNS },
        );
      });

      it("keeps node rectangles apart", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const rects = [
              ...layout(c.graph, optionsOf(c, ranks)).nodes.values(),
            ];
            for (let i = 0; i < rects.length; i++) {
              for (let j = i + 1; j < rects.length; j++) {
                expect(overlapping(rects[i], rects[j])).toBe(false);
              }
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("keeps cluster members inside their boxes", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            const centres = new Map(
              Array.from(result.nodes, ([id, r]) => [id, centreOf(r)] as const),
            );
            const violations = boxViolations(c.graph, centres, result.clusters);
            expect(violations.members).toEqual([]);
          }),
          { numRuns: RUNS },
        );
      });

      it("reports metrics equal to measuring its own drawing", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            expect(result.metrics).toEqual(
              measureDrawing(drawingOf(c.graph, result)),
            );
          }),
          { numRuns: RUNS },
        );
      });

      it("draws every edge orthogonally, between its end nodes' boundaries", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            const byId = new Map(c.graph.edges.map((e) => [e.id, e] as const));
            for (const [id, edge] of result.edges) {
              const e = byId.get(id)!;
              const pts = edge.points;
              expect(pts.length).toBeGreaterThanOrEqual(2);
              for (let i = 1; i < pts.length; i++) {
                const [p, q] = [pts[i - 1], pts[i]];
                expect(
                  Math.abs(p.x - q.x) < EPS || Math.abs(p.y - q.y) < EPS,
                ).toBe(true);
              }
              expect(onBoundary(pts[0], result.nodes.get(e.source)!)).toBe(
                true,
              );
              expect(onBoundary(pts.at(-1)!, result.nodes.get(e.target)!)).toBe(
                true,
              );
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("puts the anchor at the origin", () => {
        fc.assert(
          fc.property(arb, (c) => {
            fc.pre(c.graph.nodes.length > 0);
            const anchor = c.graph.nodes[0].id;
            const result = layout(c.graph, optionsOf(c, ranks, { anchor }));
            const centre = centreOf(result.nodes.get(anchor)!);
            expect(Math.abs(centre.x) < EPS && Math.abs(centre.y) < EPS).toBe(
              true,
            );
          }),
          { numRuns: RUNS },
        );
      });

      it("reports each real node's rank and order as its layered slot", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const o = optionsOf(c, ranks);
            const result = layout(c.graph, o);
            layeredOrder(c.graph, o).forEach((layer, rank) => {
              const real = layer.filter((id) => !id.startsWith("#"));
              real.forEach((id, order) => {
                expect(result.nodes.get(id)).toMatchObject({ rank, order });
              });
            });
          }),
          { numRuns: RUNS },
        );
      });

      it("feeds the hints back: the same ranks, and for route graphs the same real-node order unless the ordering improves", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const o = optionsOf(c, ranks);
            const first = layout(c.graph, o);
            const hinted = { ...o, hints: first.hints };
            const again = layout(c.graph, hinted);
            const improved =
              orderingCrossings(c.graph, hinted) <
              orderingCrossings(c.graph, o) - EPS;
            for (const [id, n] of first.nodes) {
              expect(again.nodes.get(id)!.rank).toBe(n.rank);
              if (suite === "route" && !improved) {
                expect(again.nodes.get(id)!.order).toBe(n.order);
              }
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("moves no node more than HINT_MOVE_EXTENTS smallest extents when the layered order repeats", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const o = optionsOf(c, ranks);
            const first = layout(c.graph, o);
            const hinted = { ...o, hints: first.hints };
            const again = layout(c.graph, hinted);
            if (
              JSON.stringify(layeredOrder(c.graph, o)) !==
              JSON.stringify(layeredOrder(c.graph, hinted))
            ) {
              return;
            }
            const smallest = Math.min(
              ...c.graph.nodes.map((n) => Math.min(n.width, n.height)),
            );
            expect(maxMove(first, again)).toBeLessThanOrEqual(
              HINT_MOVE_EXTENTS * smallest,
            );
          }),
          { numRuns: RUNS, seed: 2024 },
        );
      });

      it("rejects invalid input with every issue", () => {
        fc.assert(
          fc.property(arb, (c) => {
            const first = c.graph.nodes[0].id;
            const bad: LayoutGraph = {
              ...c.graph,
              edges: [
                ...c.graph.edges,
                {
                  id: "x1",
                  source: "nowhere",
                  target: first,
                  kind: "dependency",
                },
                {
                  id: "x2",
                  source: first,
                  target: first,
                  kind: "unknown-kind",
                },
              ],
            };
            const o = optionsOf(c, ranks);
            const issues = validateGraph(bad, o);
            expect(issues.length).toBeGreaterThanOrEqual(2);
            try {
              layout(bad, o);
              expect.unreachable("layout should have thrown");
            } catch (err) {
              expect(err).toBeInstanceOf(LayoutInputError);
              expect((err as LayoutInputError).issues).toEqual(issues);
            }
          }),
          { numRuns: RUNS },
        );
      });
    });
  }
});

describe("hint round trip", () => {
  it("keeps the order when a zero-crossing order exists only after its dummies move", () => {
    // A dummy chain beside n4 must move for the hinted order to reach zero crossings; the search instead swaps n1 and n4.
    const twoPorts = (east = false) => [
      {
        id: "p0",
        side: east ? ("east" as const) : ("north" as const),
        offset: 0,
      },
      { id: "p1", side: "north" as const, offset: 0 },
    ];
    const graph: LayoutGraph = {
      nodes: Array.from({ length: 8 }, (_, i) => ({
        id: `n${i}`,
        width: 20,
        height: 20,
        ports: twoPorts(i === 2),
      })),
      edges: [
        { id: "e0", source: "n6", target: "n2", kind: "dependency" },
        { id: "e1", source: "n3", target: "n1", kind: "dependency" },
        { id: "e2", source: "n1", target: "n2", kind: "dependency" },
        {
          id: "e3",
          source: "n0",
          target: "n2",
          kind: "dependency",
          targetPort: "p1",
        },
        { id: "e4", source: "n3", target: "n4", kind: "column" },
        { id: "e5", source: "n6", target: "n3", kind: "dependency" },
        {
          id: "e6",
          source: "n1",
          target: "n2",
          kind: "dependency",
          targetPort: "p0",
        },
      ],
    };
    const o = optionsOf({ graph, direction: "down", effort: "fast" }, "rows");
    const first = layout(graph, o);
    const again = layout(graph, { ...o, hints: first.hints });
    for (const [id, n] of first.nodes) {
      expect(again.nodes.get(id)!.order).toBe(n.order);
    }
  });
});
