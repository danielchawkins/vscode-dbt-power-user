import { expect, it } from "vitest";
import { type Budget, budgetOf } from "./budget.js";

// The counts each phase used to read from its own effort table, before the budget existed. A change here changes what
// every run spends, so it needs a deliberate reason.
it("holds the counts each phase's table held, at every effort", () => {
  expect(budgetOf({ effort: "fast" })).toEqual<Budget>({
    rankPivots: 1_000,
    sweeps: 4,
    siftRounds: 0,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 0,
    placeIterations: 0,
    routePairs: 100_000,
    doglegWork: 20_000,
  });
  expect(budgetOf({ effort: "balanced" })).toEqual<Budget>({
    rankPivots: 10_000,
    sweeps: 12,
    siftRounds: 3,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 0,
    placeIterations: 100,
    routePairs: 1_000_000,
    doglegWork: 200_000,
  });
  expect(budgetOf({ effort: "thorough" })).toEqual<Budget>({
    rankPivots: 100_000,
    sweeps: 24,
    siftRounds: 3,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 8,
    placeIterations: 500,
    routePairs: 4_000_000,
    doglegWork: 1_000_000,
  });
});

it("reads balanced when no effort is given", () => {
  expect(budgetOf({})).toBe(budgetOf({ effort: "balanced" }));
});
