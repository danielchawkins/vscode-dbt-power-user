import { describe, expect, it } from "vitest";
import { runPhases } from "../phases.js";
import { bandedGraph, bandedOptions } from "../testing/bandedGraph.js";
import { exactMinimumCrossings } from "../testing/exactCrossings.js";

// Golden: the banded graph's exact minimum weighted crossings, found by exhaustive search over every
// cluster-contiguous order, and how close each effort comes to it.

/** The exact minimum, and how far above it `balanced` stops. A change to either is a change to the search. */
const EXACT_MINIMUM = 1;
const BALANCED_GAP = 2;

describe("ordering against the exact minimum on the banded graph", () => {
  it("has the recorded exact minimum", () => {
    const { ordering } = runPhases(bandedGraph, bandedOptions);
    expect(exactMinimumCrossings(ordering).crossings).toBe(EXACT_MINIMUM);
  });

  it.each([0, 1, 7, 42])("reaches it at thorough with seed %i", (seed) => {
    const { ordering } = runPhases(bandedGraph, {
      ...bandedOptions,
      effort: "thorough",
      seed,
    });
    expect(ordering.crossings).toBe(EXACT_MINIMUM);
  });

  it("stops the recorded gap above it at balanced", () => {
    const { ordering } = runPhases(bandedGraph, {
      ...bandedOptions,
      effort: "balanced",
    });
    expect(ordering.crossings).toBe(EXACT_MINIMUM + BALANCED_GAP);
  });
});
