import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layout } from "./layout.js";
import { measureDrawing } from "./metrics.js";
import { allowedOf, breachesOf, holdersOf } from "./opaque.js";
import { caseArb as boxCaseArb } from "./testing/boxes.js";
import { withClusters } from "./testing/graphs.js";
import {
  drawingOf,
  optionsOf,
  RANKS,
  type Case,
} from "./testing/layoutChecks.js";
import { caseArb as routeCaseArb } from "./testing/routeGraphs.js";
import type { LayoutGraph, LayoutResult, Point, Rect } from "./types.js";

const RUNS = 60;
/**
 * The most edges, as a share, that may be flagged `routeFailed` across the property runs: the measured share on these
 * suites (about a third, all clusters opaque at random). A ratchet: lower it as endpoint placement lands (roadmap B).
 */
const FLAGGED_CEILING = 0.35;

/**
 * Clustered graphs (nested clusters, long edges) with each cluster opaque or transparent at random, so that the
 * property covers mixed walls and layer bands.
 */
const mixedArb = fc
  .tuple(boxCaseArb, fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }))
  .map(([c, opaque]) => ({
    ...c,
    graph: withOpacity(c.graph, opaque),
  }));

/** Route graphs (ports on edges, a kind that is not routed) with three nested clusters, all opaque. */
const portsArb = fc
  .tuple(
    routeCaseArb,
    fc.array(fc.nat(3), { minLength: 9, maxLength: 9 }),
    fc.array(fc.nat(3), { minLength: 3, maxLength: 3 }),
  )
  .map(([c, memberOf, parentOf]) => ({
    ...c,
    graph: withOpacity(withClusters(c.graph, memberOf, parentOf), [
      true,
      true,
      true,
    ]),
  }));

const SUITES = [
  ["mixed", mixedArb],
  ["ports", portsArb],
] as const;

function withOpacity(
  graph: LayoutGraph,
  opaque: readonly boolean[],
): LayoutGraph {
  return {
    ...graph,
    clusters: (graph.clusters ?? []).map((cluster, k) => ({
      ...cluster,
      opaque: opaque[k] ?? false,
    })),
  };
}

/** The opaque boxes of a layout, and for each edge the boxes it may enter. */
function opaqueOf(graph: LayoutGraph, result: LayoutResult) {
  const opaque = new Set(
    (graph.clusters ?? []).filter((c) => c.opaque === true).map((c) => c.id),
  );
  const boxes = new Map<string, Rect>(
    [...result.clusters].filter(([id]) => opaque.has(id)),
  );
  const holders = holdersOf(graph);
  const byId = new Map(graph.edges.map((e) => [e.id, e] as const));
  const allowed = new Map(
    Array.from(byId, ([id, e]) => [id, allowedOf(holders, e.source, e.target)]),
  );
  return { boxes, allowed };
}

describe.each(SUITES)("opaque boxes on %s graphs", (suite, arb) => {
  for (const ranks of RANKS) {
    describe(`ranks ${ranks}`, () => {
      it("keeps every drawn edge out of the opaque boxes it may not enter", () => {
        fc.assert(
          fc.property(arb, (c: Case) => {
            const result = layout(c.graph, optionsOf(c, ranks));
            const opaque = opaqueOf(c.graph, result);
            const metrics = measureDrawing({
              ...drawingOf(c.graph, result),
              opaque,
            });
            expect(metrics.opaqueBreaches).toBe(0);
            for (const [id, edge] of result.edges) {
              if (!edge.routeFailed) {
                expect(
                  breachesOf(
                    edge.points,
                    opaque.boxes,
                    opaque.allowed.get(id)!,
                  ),
                ).toEqual([]);
              }
            }
          }),
          { numRuns: RUNS },
        );
      });

      it("draws or flags every routed edge, and draws no flagged edge", () => {
        let flagged = 0;
        let total = 0;
        fc.assert(
          fc.property(arb, (c: Case) => {
            const o = optionsOf(c, ranks);
            const result = layout(c.graph, o);
            const routed = c.graph.edges
              .filter((e) => o.edgeKinds[e.kind]?.routed !== false)
              .map((e) => e.id)
              .sort((a, b) => a.localeCompare(b));
            const ids = [...result.edges.keys()].sort((a, b) =>
              a.localeCompare(b),
            );
            expect(ids).toEqual(routed);
            for (const edge of result.edges.values()) {
              total++;
              if (edge.routeFailed) {
                flagged++;
                expect(edge.points).toEqual([]);
              } else {
                expect(edge.points.length).toBeGreaterThanOrEqual(2);
              }
            }
          }),
          { numRuns: RUNS, seed: 7 },
        );
        // Ratchet: flagging must not become the way to pass. See FLAGGED_CEILING.
        expect(flagged / Math.max(total, 1)).toBeLessThanOrEqual(
          FLAGGED_CEILING,
        );
      });
    });
  }
});

describe("opaque box breaches", () => {
  const box: Rect = { x: 0, y: 0, width: 10, height: 10 };
  const none = new Set<string>();
  const entersOpaque = (points: readonly Point[], target: Rect): boolean =>
    breachesOf(points, new Map([["box", target]]), none).length > 0;

  it("counts a piece through the interior", () => {
    const through: Point[] = [
      { x: -5, y: 5 },
      { x: 15, y: 5 },
    ];
    expect(entersOpaque(through, box)).toBe(true);
  });

  it("counts a piece within the clearance of the border", () => {
    const hugging: Point[] = [
      { x: -5, y: 0 },
      { x: 15, y: 0 },
    ];
    const near: Point[] = [
      { x: -5, y: -0.5 },
      { x: 15, y: -0.5 },
    ];
    expect(entersOpaque(hugging, box)).toBe(true);
    expect(entersOpaque(near, box)).toBe(true);
  });

  it("does not count a piece beyond the clearance", () => {
    const far: Point[] = [
      { x: -5, y: -2 },
      { x: 15, y: -2 },
    ];
    expect(entersOpaque(far, box)).toBe(false);
  });

  it("leaves out a box the edge may enter", () => {
    const through: Point[] = [
      { x: 5, y: -5 },
      { x: 5, y: 15 },
    ];
    const boxes = new Map([["c", box]]);
    expect(breachesOf(through, boxes, none)).toEqual(["c"]);
    expect(breachesOf(through, boxes, new Set(["c"]))).toEqual([]);
  });
});
