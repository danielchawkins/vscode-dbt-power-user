import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import type { RankResult } from "../rank/index.js";
import {
  graphArb,
  options,
  randomModel,
  sortedRanks,
} from "../testing/graphs.js";
import type { LayoutGraph } from "../types.js";
import { totalCrossings } from "./crossings.js";
import { createModel } from "./model.js";
import { sift } from "./sifting.js";

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
