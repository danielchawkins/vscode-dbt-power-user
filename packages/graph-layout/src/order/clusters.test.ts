import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { rank } from "../rank/index.js";
import { clusteredGraphArb, options, randomModel } from "../testing/graphs.js";
import { gatherClusters, legalSlots } from "./clusters.js";
import { order } from "./index.js";
import { sift } from "./sifting.js";
import { search } from "./sweeps.js";
import { transpose } from "./transpose.js";

/** The clusters `clusteredGraphArb` adds. */
const CLUSTERS = 3;

/** Whether, in every rank, each cluster's layered nodes form one unbroken run. */
function contiguous(
  layers: readonly number[][],
  paths: readonly number[][],
): boolean {
  return layers.every((layer) =>
    Array.from({ length: CLUSTERS }, (_, c) =>
      layer.flatMap((x, k) => (paths[x].includes(c) ? [k] : [])),
    ).every((at) => at.length === 0 || at.at(-1)! - at[0] + 1 === at.length),
  );
}

/**
 * Whether two clusters with no node in common keep one order in every rank where both have members: the sibling
 * clusters of a drawing do not swap places from rank to rank.
 */
function siblingsKeepOrder(
  layers: readonly number[][],
  paths: readonly number[][],
): boolean {
  for (let c = 0; c < CLUSTERS; c++) {
    for (let d = c + 1; d < CLUSTERS; d++) {
      if (paths.some((p) => p.includes(c) && p.includes(d))) {
        continue;
      }
      const sides = layers.flatMap((layer) => {
        const at = (k: number) =>
          layer.flatMap((x, i) => (paths[x].includes(k) ? [i] : []));
        const cs = at(c);
        const ds = at(d);
        return cs.length > 0 && ds.length > 0 ? [cs[0] < ds[0]] : [];
      });
      if (sides.some((s) => s !== sides[0])) {
        return false;
      }
    }
  }
  return true;
}

describe("order with clusters", () => {
  it("keeps every cluster contiguous in every rank of the order", () => {
    fc.assert(
      fc.property(clusteredGraphArb, (graph) => {
        const result = order(graph, options, rank(graph, options));
        expect(contiguous(result.layers, result.layered.paths)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps sibling clusters in one order across the ranks", () => {
    fc.assert(
      fc.property(clusteredGraphArb, (graph) => {
        const result = order(graph, options, rank(graph, options));
        expect(siblingsKeepOrder(result.layers, result.layered.paths)).toBe(
          true,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("keeps every cluster contiguous through gathering, sifting, transposition and search", () => {
    fc.assert(
      fc.property(clusteredGraphArb, fc.nat(1000), (graph, seed) => {
        const model = randomModel(graph, seed);
        gatherClusters(model);
        expect(contiguous(model.layers, model.graph.paths)).toBe(true);
        sift(model, 2);
        expect(contiguous(model.layers, model.graph.paths)).toBe(true);
        transpose(model);
        expect(contiguous(model.layers, model.graph.paths)).toBe(true);
        search(model, 4);
        expect(contiguous(model.layers, model.graph.paths)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe("legalSlots", () => {
  it("allows a unit only beside its cluster's members and never inside another cluster", () => {
    // Others: two members of cluster 0, then a unit outside every cluster.
    expect(legalSlots([0], [[0], [0], []], 0)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    // A unit outside clusters may not enter the span of cluster 0.
    expect(legalSlots([], [[0], [0], []], 3)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("does not let a unit pass a sibling cluster, even when its own cluster has no other members here", () => {
    // Cluster 1 sits left of cluster 0 in this rank: the unit of cluster 0 may not move left past it.
    expect(legalSlots([0], [[1]], 1)).toEqual([false, true]);
  });
});
