import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import type { RankResult } from "../rank/index.js";
import { rank } from "../rank/index.js";
import { seededRandom, shuffled } from "../random.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "../types.js";
import { totalCrossings } from "./crossings.js";
import { createModel, type OrderModel } from "./model.js";
import { found, search } from "./sweeps.js";

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

const sortedRanks = (model: OrderModel) =>
  model.layers.map((l) => l.toSorted((a, b) => a - b));

describe("search", () => {
  it("keeps the order with the fewest crossings, and leaves the model at it", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const model = randomModel(graph, seed);
        const start = totalCrossings(model);
        const ranksBefore = sortedRanks(model);
        const best = search(model, 6);
        expect(best.crossings).toBeLessThanOrEqual(start);
        expect(totalCrossings(model)).toBe(best.crossings);
        expect(found(model)).toEqual(best);
        expect(sortedRanks(model)).toEqual(ranksBefore);
      }),
      { numRuns: 200 },
    );
  });

  it("untangles two crossing links between two ranks", () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: "a", width: 80, height: 40 },
        { id: "b", width: 80, height: 40 },
        { id: "c", width: 80, height: 40 },
        { id: "d", width: 80, height: 40 },
      ],
      edges: [
        { id: "e1", source: "a", target: "d", kind: "dependency" },
        { id: "e2", source: "b", target: "c", kind: "dependency" },
      ],
    };
    const ranking: RankResult = {
      ranks: new Map([
        ["a", 0],
        ["b", 0],
        ["c", 1],
        ["d", 1],
      ]),
      reversed: [],
    };
    const model = createModel(layer(graph, options, ranking), [
      [0, 1],
      [2, 3],
    ]);
    // With c left of d, a's link to d and b's link to c cross.
    expect(totalCrossings(model)).toBe(1);
    const best = search(model, 4);
    expect(best.crossings).toBe(0);
    expect(totalCrossings(model)).toBe(0);
    expect(model.layers[1]).toEqual([3, 2]);
  });

  it("gives the same order for the same start", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const first = search(randomModel(graph, seed), 8);
        const second = search(randomModel(graph, seed), 8);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });
});

const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 1, max: 9 })
  .chain((count) =>
    fc
      .array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1), fc.nat(1)), {
        maxLength: 16,
      })
      .map((specs) => ({
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `n${i}`,
          width: 80,
          height: 40,
        })),
        edges: specs.map(
          ([a, b, k], i): LayoutEdge => ({
            id: `e${i}`,
            source: `n${a}`,
            target: `n${b}`,
            kind: k === 0 ? "dependency" : "column",
          }),
        ),
      })),
  );

/** A model of `graph` with each rank's order shuffled by `seed`. */
function randomModel(graph: LayoutGraph, seed: number): OrderModel {
  const laid = layer(graph, options, rank(graph, options));
  const random = seededRandom(seed);
  const layers: number[][] = Array.from({ length: laid.ranks }, () => []);
  laid.nodes.forEach((node, i) => layers[node.rank].push(i));
  return createModel(
    laid,
    layers.map((layerNodes) => shuffled(layerNodes, random)),
  );
}
