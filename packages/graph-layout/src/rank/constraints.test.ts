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
  it("adds no nodes for a single band", () => {
    const ext = partitionConstraints([0, 0, 0], "strict");
    expect(ext.count).toBe(3);
    expect(ext.edges).toEqual([]);
  });

  it("adds one gate per boundary under strict partitions", () => {
    const ext = partitionConstraints([0, 1, 2], "strict");
    expect(ext.count).toBe(5);
  });

  it("adds one mediator per node above the lowest band under soft partitions", () => {
    const ext = partitionConstraints([0, 1, 1, 2], "soft");
    // Two gates for three bands, plus a mediator for each of the three nodes above band 0.
    expect(ext.count).toBe(4 + 2 + 3);
  });

  it("keeps bands in order under strict partitions", () => {
    const partitions = [2, 0, 1, 0, 2, 1];
    const ranks = solve(
      partitions.length,
      [],
      partitionConstraints(partitions, "strict"),
    );
    for (let i = 0; i < partitions.length; i++) {
      for (let j = 0; j < partitions.length; j++) {
        if (partitions[i] < partitions[j]) {
          expect(ranks[i]).toBeLessThan(ranks[j]);
        }
      }
    }
  });

  it("keeps a ranking edge's minimum length under soft partitions, even against the bands", () => {
    // Node 1 is in the higher band but must sit one rank above node 0; the soft band costs, the edge does not bend.
    const base: NetworkEdge[] = [{ tail: 1, head: 0, minLength: 1, weight: 1 }];
    const ranks = solve(2, base, partitionConstraints([0, 1], "soft"));
    expect(ranks[0] - ranks[1]).toBeGreaterThanOrEqual(1);
  });

  it("places a higher band below the lower band's gate when nothing pulls against it", () => {
    const ranks = solve(2, [], partitionConstraints([0, 1], "soft"));
    expect(ranks[1]).toBeGreaterThan(ranks[0]);
  });

  it("returns an empty extension for no nodes", () => {
    expect(partitionConstraints([], "strict")).toEqual({ count: 0, edges: [] });
  });
});

describe("hintConstraints", () => {
  it("adds nothing when no node has a hint", () => {
    expect(hintConstraints(4, [undefined, undefined], 1)).toEqual({
      count: 4,
      edges: [],
    });
  });

  it("keeps each hinted node at its hinted rank relative to the others", () => {
    const ranks = solve(2, [], hintConstraints(2, [0, 3], 1));
    expect(ranks).toEqual([0, 3]);
  });

  it("keeps the gap between hinted nodes when the hints move together", () => {
    const ranks = solve(3, [], hintConstraints(3, [5, 7, undefined], 1));
    expect(ranks[1] - ranks[0]).toBe(2);
  });

  it("respects a ranking edge even when hints pull against it", () => {
    // Node 0 wants to sit one rank above node 1 by minimum length; its hint says 0 and node 1's hint says 0 too.
    const base: NetworkEdge[] = [{ tail: 1, head: 0, minLength: 1, weight: 1 }];
    const ranks = solve(2, base, hintConstraints(2, [0, 0], 50));
    expect(ranks[0] - ranks[1]).toBeGreaterThanOrEqual(1);
  });
});
