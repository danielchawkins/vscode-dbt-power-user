import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { problemArb } from "../testing/problems.js";
import { brandesKoepf } from "./brandesKoepf.js";
import type { Problem } from "./problem.js";

describe("brandesKoepf", () => {
  it("keeps every rank separated by its gaps", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const x = brandesKoepf(problem);
        for (const layer of problem.layers) {
          for (let k = 1; k < layer.length; k++) {
            const a = layer[k - 1];
            const b = layer[k];
            expect(x[b] - x[a]).toBeGreaterThanOrEqual(
              problem.gapLeft[b] - 1e-9,
            );
          }
        }
      }),
    );
  });

  it("returns one coordinate per node", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        expect(brandesKoepf(problem)).toHaveLength(problem.dummy.length);
      }),
    );
  });

  it("keeps every gap in the class-shift counterexample", () => {
    const span = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => from + i);
    const link = (top: number, bottom: number) => ({
      top,
      bottom,
      weight: 1,
      topOffset: 0,
      bottomOffset: 0,
    });
    const problem: Problem = {
      layers: [span(0, 7), span(7, 14), [14, 15], span(16, 21), span(21, 25)],
      gapLeft: span(0, 25).map(() => 1),
      dummy: span(0, 25).map(() => false),
      links: [link(16, 21), link(14, 17)],
      pulls: [],
    };
    const x = brandesKoepf(problem);
    for (const layer of problem.layers) {
      for (let k = 1; k < layer.length; k++) {
        const a = layer[k - 1];
        const b = layer[k];
        expect(x[b] - x[a]).toBeGreaterThanOrEqual(1 - 1e-9);
      }
    }
  });

  it("keeps a chain of dummies on one straight line", () => {
    // a -> d1 -> d2 -> b, with a second chain beside it on the same ranks.
    const problem: Problem = {
      layers: [
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ],
      gapLeft: [0, 0, 0, 0, 10, 10, 10, 10],
      dummy: [false, true, true, false, false, true, true, false],
      links: [
        { top: 0, bottom: 1, weight: 2, topOffset: 0, bottomOffset: 0 },
        { top: 1, bottom: 2, weight: 8, topOffset: 0, bottomOffset: 0 },
        { top: 2, bottom: 3, weight: 2, topOffset: 0, bottomOffset: 0 },
        { top: 4, bottom: 5, weight: 2, topOffset: 0, bottomOffset: 0 },
        { top: 5, bottom: 6, weight: 8, topOffset: 0, bottomOffset: 0 },
        { top: 6, bottom: 7, weight: 2, topOffset: 0, bottomOffset: 0 },
      ],
      pulls: [],
    };
    const x = brandesKoepf(problem);
    expect(x[0]).toBeCloseTo(x[1], 9);
    expect(x[1]).toBeCloseTo(x[2], 9);
    expect(x[2]).toBeCloseTo(x[3], 9);
    expect(x[4]).toBeCloseTo(x[5], 9);
    expect(x[5]).toBeCloseTo(x[6], 9);
    expect(x[6]).toBeCloseTo(x[7], 9);
    expect(x[4] - x[0]).toBeGreaterThanOrEqual(10 - 1e-9);
  });
});
