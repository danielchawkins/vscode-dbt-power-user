import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rank } from "../rank/index.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "../types.js";
import { order } from "./index.js";

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
      .array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1), fc.nat(1)), {
        maxLength: 18,
      })
      .map((specs) => ({
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `n${i}`,
          width: 80,
          height: 40,
        })),
        edges: specs.map(([a, b, k], i): LayoutEdge => ({
          id: `e${i}`,
          source: `n${a}`,
          target: `n${b}`,
          kind: k === 0 ? "dependency" : "column",
        })),
      })),
  );

describe("order", () => {
  it("places every node and dummy of each rank exactly once, in that rank", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const result = order(graph, options, rank(graph, options));
        const seen = result.layers.flat().sort((a, b) => a - b);
        expect(seen).toEqual(result.layered.nodes.map((_, i) => i));
        result.layers.forEach((layer, r) => {
          for (const x of layer) {
            expect(result.layered.nodes[x].rank).toBe(r);
          }
        });
      }),
      { numRuns: 200 },
    );
  });

  it("is a pure function of the graph, options and seed", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const thorough = { ...options, effort: "thorough" as const, seed };
        const ranking = rank(graph, thorough);
        expect(order(graph, thorough, ranking)).toEqual(
          order(graph, thorough, ranking),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("is no worse at thorough effort than at balanced", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const balanced = { ...options, effort: "balanced" as const, seed };
        const thorough = { ...balanced, effort: "thorough" as const };
        const ranking = rank(graph, balanced);
        expect(order(graph, thorough, ranking).crossings).toBeLessThanOrEqual(
          order(graph, balanced, ranking).crossings,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the previous order of a drawing that has no crossings", () => {
    // a feeds b and c, and b feeds d: b and c can sit in either order without crossing.
    const graph: LayoutGraph = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, width: 80, height: 40 })),
      edges: [
        { id: "ab", source: "a", target: "b", kind: "dependency" },
        { id: "ac", source: "a", target: "c", kind: "dependency" },
        { id: "bd", source: "b", target: "d", kind: "dependency" },
      ],
    };
    const hints = {
      nodes: new Map([
        ["a", { rank: 0, order: 0, x: 0, y: 0 }],
        ["c", { rank: 1, order: 0, x: 0, y: 0 }],
        ["b", { rank: 1, order: 1, x: 0, y: 0 }],
        ["d", { rank: 2, order: 0, x: 0, y: 0 }],
      ]),
    };
    const result = order(graph, { ...options, hints }, rank(graph, options));
    expect(result.crossings).toBe(0);
    expect(result.layers[1].map((x) => result.layered.nodes[x].id)).toEqual([
      "c",
      "b",
    ]);
  });
});
