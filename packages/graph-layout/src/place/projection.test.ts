import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectRanks } from "./projection.js";

interface Case {
  layers: number[][];
  gapLeft: number[];
  weight: number[];
  x: number[];
}

/** Random ranks of consecutive node ids, with random gaps, weights and starting coordinates. */
const caseArb: fc.Arbitrary<Case> = fc
  .array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 })
  .chain((sizes) => {
    const count = sizes.reduce((a, b) => a + b, 0);
    const layers: number[][] = [];
    let next = 0;
    for (const size of sizes) {
      layers.push(Array.from({ length: size }, () => next++));
    }
    const list = (min: number, max: number) =>
      fc.array(fc.double({ min, max, noNaN: true }), {
        minLength: count,
        maxLength: count,
      });
    return fc
      .tuple(list(-20, 20), list(0, 5), list(0.1, 5))
      .map(([x, gapLeft, weight]) => ({
        layers,
        gapLeft,
        weight,
        x,
      }));
  });

/** Whether every node sits at least its gap beyond its left neighbour, within `slack`. */
function separated(c: Case, x: number[], slack: number): boolean {
  return c.layers.every((layer) =>
    layer.slice(1).every((v, k) => x[v] - x[layer[k]] >= c.gapLeft[v] - slack),
  );
}

describe("projectRanks", () => {
  it("leaves every rank separated by its gaps", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const x = [...c.x];
        projectRanks(c, x, c.weight);
        expect(separated(c, x, 1e-9)).toBe(true);
      }),
    );
  });

  it("leaves a feasible point where it is", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const once = [...c.x];
        projectRanks(c, once, c.weight);
        const twice = [...once];
        projectRanks(c, twice, c.weight);
        twice.forEach((value, i) => expect(value).toBeCloseTo(once[i], 9));
      }),
    );
  });

  it("spreads two coincident nodes by the gap, split by their weights", () => {
    const x = [0, 0];
    projectRanks({ layers: [[0, 1]], gapLeft: [0, 2] }, x, [1, 1]);
    expect(x).toEqual([-1, 1]);
  });

  it("moves the lighter node further when the weights differ", () => {
    const x = [0, 0];
    projectRanks({ layers: [[0, 1]], gapLeft: [0, 2] }, x, [3, 1]);
    expect(x[1] - x[0]).toBeCloseTo(2, 12);
    expect(x[0] / x[1]).toBeCloseTo(-1 / 3, 12);
  });
});
