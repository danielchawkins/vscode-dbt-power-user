import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { order } from "../order/index.js";
import { rank } from "../rank/index.js";
import type { LayoutGraph, LayoutOptions, Point } from "../types.js";
import { place } from "./index.js";

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 2, max: 9 })
  .chain((count) =>
    fc
      .tuple(
        fc.array(
          fc.tuple(
            fc.integer({ min: 20, max: 120 }),
            fc.integer({ min: 20, max: 80 }),
          ),
          { minLength: count, maxLength: count },
        ),
        fc.array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1), fc.nat(1)), {
          maxLength: 18,
        }),
      )
      .map(([sizes, specs]) => ({
        nodes: sizes.map(([width, height], i) => ({
          id: `n${i}`,
          width,
          height,
        })),
        edges: specs.map(([a, b, k], i) => ({
          id: `e${i}`,
          source: `n${a}`,
          target: `n${b}`,
          kind: k === 0 ? "dependency" : "column",
        })),
      })),
  );

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Places a graph with the given options, through the whole ordering phase. */
function placeGraph(graph: LayoutGraph, opts: LayoutOptions) {
  return place(graph, opts, order(graph, opts, rank(graph, opts)));
}

/** The box of each real node, from its centre and its size. */
function boxesOf(
  graph: LayoutGraph,
  centres: ReadonlyMap<string, Point>,
): Box[] {
  return graph.nodes.flatMap((node) => {
    const c = centres.get(node.id);
    expect(c).toBeDefined();
    if (c === undefined) {
      return [];
    }
    return [
      {
        x0: c.x - node.width / 2,
        x1: c.x + node.width / 2,
        y0: c.y - node.height / 2,
        y1: c.y + node.height / 2,
      },
    ];
  });
}

/** Whether two boxes overlap with positive area. */
function overlaps(a: Box, b: Box): boolean {
  const eps = 1e-6;
  return (
    a.x0 < b.x1 - eps &&
    b.x0 < a.x1 - eps &&
    a.y0 < b.y1 - eps &&
    b.y0 < a.y1 - eps
  );
}

describe("place", () => {
  it.each(["down", "right"] as const)(
    "keeps every pair of real boxes apart (%s)",
    (direction) => {
      const opts = { ...options, direction };
      fc.assert(
        fc.property(graphArb, (graph) => {
          const boxes = boxesOf(graph, placeGraph(graph, opts).nodes);
          boxes.forEach((a, i) => {
            boxes.slice(i + 1).forEach((b) => {
              expect(overlaps(a, b)).toBe(false);
            });
          });
        }),
      );
    },
  );

  it("holds an anchor exactly at the origin", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const placed = placeGraph(graph, { ...options, anchor: "n0" });
        const anchor = placed.nodes.get("n0");
        expect(anchor?.x).toBe(0);
        expect(anchor?.y).toBe(0);
      }),
    );
  });

  it("returns a point for every layered node, real nodes first", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const ordering = order(graph, options, rank(graph, options));
        const placed = place(graph, options, ordering);
        expect(placed.points).toHaveLength(ordering.layered.nodes.length);
        ordering.layered.nodes.forEach((node, i) => {
          if (node.id !== undefined) {
            expect(placed.nodes.get(node.id)).toEqual(placed.points[i]);
          }
        });
      }),
      { numRuns: 100 },
    );
  });

  it("does no solver work at fast effort and at most its cap otherwise", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        expect(placeGraph(graph, { ...options, effort: "fast" }).work).toBe(0);
        expect(
          placeGraph(graph, { ...options, effort: "balanced" }).work,
        ).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  it("draws a hinted node to its previous top-left corner plus half its size", () => {
    const graph: LayoutGraph = {
      nodes: [{ id: "a", width: 80, height: 40 }],
      edges: [],
    };
    const hints = {
      nodes: new Map([["a", { rank: 0, order: 0, x: 100, y: 7 }]]),
    };
    const placed = placeGraph(graph, { ...options, hints });
    expect(placed.nodes.get("a")?.x).toBeCloseTo(140, 6);
  });
});
