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
import { transpose } from "./transpose.js";

describe("transpose", () => {
  it("never raises the crossings, and keeps each rank's nodes", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const model = randomModel(graph, seed);
        const before = totalCrossings(model);
        const ranksBefore = sortedRanks(model);
        transpose(model);
        expect(totalCrossings(model)).toBeLessThanOrEqual(before);
        expect(sortedRanks(model)).toEqual(ranksBefore);
      }),
      { numRuns: 200 },
    );
  });

  it("untangles two crossing links between two ranks in one call", () => {
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
    transpose(model);
    expect(totalCrossings(model)).toBe(0);
    expect(model.layers).toEqual([
      [1, 0],
      [2, 3],
    ]);
  });
});
