import { describe, expect, it } from "vitest";
import {
  type Extension,
  hintConstraints,
  partitionConstraints,
} from "./constraints.js";
import { type NetworkEdge, networkSimplex } from "./networkSimplex.js";

const CAP = 10_000;

/** Ranks `real` nodes, plus whatever the constraint adds, with the given ranking edges. */
function solve(real: number, base: NetworkEdge[], ext: Extension): number[] {
  return networkSimplex(ext.count, [...base, ...ext.edges], CAP).slice(0, real);
}

describe("partitionConstraints", () => {
  it("places a higher band below the lower band's gate when nothing pulls against it", () => {
    const ranks = solve(2, [], partitionConstraints([0, 1], "soft"));
    expect(ranks[1]).toBeGreaterThan(ranks[0]);
  });
});

describe("hintConstraints", () => {
  it.each([
    { hints: [0, 3], distance: 3 },
    { hints: [5, 7, undefined], distance: 2 },
  ])(
    "keeps the second node its hinted distance from the first, for hints $hints",
    ({ hints, distance }) => {
      const ranks = solve(
        hints.length,
        [],
        hintConstraints(hints.length, hints, 1),
      );
      expect(ranks[1] - ranks[0]).toBe(distance);
    },
  );

  it("respects a ranking edge even when hints pull against it", () => {
    // Node 0 wants to sit one rank above node 1 by minimum length; its hint says 0 and node 1's hint says 0 too.
    const base: NetworkEdge[] = [{ tail: 1, head: 0, minLength: 1, weight: 1 }];
    const ranks = solve(2, base, hintConstraints(2, [0, 0], 50));
    expect(ranks[0] - ranks[1]).toBeGreaterThanOrEqual(1);
  });
});
