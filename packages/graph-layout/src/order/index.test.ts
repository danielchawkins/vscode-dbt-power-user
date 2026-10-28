import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rank } from "../rank/index.js";
import { options } from "../testing/graphs.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutHints,
  LayoutOptions,
} from "../types.js";
import { order, type OrderResult } from "./index.js";

/** Like the shared graphArb, with at least two nodes and up to eighteen edges. */
const denseGraphArb: fc.Arbitrary<LayoutGraph> = fc
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
      fc.property(denseGraphArb, (graph) => {
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
      fc.property(denseGraphArb, fc.integer(), (graph, seed) => {
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
      fc.property(denseGraphArb, fc.integer(), (graph, seed) => {
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

  it("mostly keeps its own result when the hints come from that result", () => {
    // Hints are a preference: a rerun may move some nodes, but most stay where they were.
    const cases = fc.sample(
      fc.tuple(
        denseGraphArb,
        fc.integer(),
        fc.constantFrom<NonNullable<LayoutOptions["effort"]>>(
          "fast",
          "balanced",
          "thorough",
        ),
      ),
      { numRuns: 300, seed: 42 },
    );
    let nodes = 0;
    let kept = 0;
    for (const [graph, seed, effort] of cases) {
      const settings = { ...options, effort, seed };
      const ranking = rank(graph, settings);
      const first = realOrders(order(graph, settings, ranking));
      const again = realOrders(
        order(graph, { ...settings, hints: hintsFrom(first) }, ranking),
      );
      first.forEach((layer, r) =>
        layer.forEach((id, k) => {
          nodes += 1;
          kept += again[r][k] === id ? 1 : 0;
        }),
      );
    }
    expect(kept / nodes).toBeGreaterThan(0.9);
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

/** Hints that place each real node at its index among the real nodes of its rank. */
function hintsFrom(layers: string[][]): LayoutHints {
  const nodes = new Map<
    string,
    { rank: number; order: number; x: number; y: number }
  >();
  layers.forEach((ids, rank) =>
    ids.forEach((id, k) => {
      nodes.set(id, { rank, order: k, x: 0, y: 0 });
    }),
  );
  return { nodes };
}

/** The ids of the real nodes of each rank, left to right. */
function realOrders(result: OrderResult): string[][] {
  return result.layers.map((layerNodes) =>
    layerNodes
      .map((x) => result.layered.nodes[x].id)
      .filter((id): id is string => id !== undefined),
  );
}
