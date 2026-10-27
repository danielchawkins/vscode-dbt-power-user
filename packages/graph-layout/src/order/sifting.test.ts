import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import type { RankResult } from "../rank/index.js";
import { rank } from "../rank/index.js";
import { seededRandom, shuffled } from "../random.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "../types.js";
import { totalCrossings } from "./crossings.js";
import { createModel, type OrderModel } from "./model.js";
import { sift } from "./sifting.js";

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

const sortedRanks = (model: OrderModel) =>
  model.layers.map((l) => l.toSorted((a, b) => a - b));

describe("sift", () => {
  it("never raises the crossings of a random order, and keeps each rank's nodes", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const model = randomModel(graph, seed);
        const before = totalCrossings(model);
        const ranksBefore = sortedRanks(model);
        sift(model, 3);
        expect(totalCrossings(model)).toBeLessThanOrEqual(before);
        expect(sortedRanks(model)).toEqual(ranksBefore);
      }),
      { numRuns: 300 },
    );
  });

  it("moves one node past the other to remove a crossing", () => {
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
    expect(totalCrossings(model)).toBe(1);
    // Rank 0 is sifted first: moving b to the left of a removes the crossing without touching rank 1.
    sift(model, 1);
    expect(model.layers[0]).toEqual([1, 0]);
    expect(totalCrossings(model)).toBe(0);
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
