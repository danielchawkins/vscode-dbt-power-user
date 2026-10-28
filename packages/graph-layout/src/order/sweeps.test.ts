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
import { found, search } from "./sweeps.js";

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
