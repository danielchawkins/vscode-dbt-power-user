import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brandesKoepf } from "./brandesKoepf.js";
import type { Problem } from "./problem.js";

/** Ranks of 1 to 7 nodes, up to five ranks, with sparse random links between adjacent ranks and random gaps, dummies and port offsets. */
const problemArb: fc.Arbitrary<Problem> = fc
  .array(fc.integer({ min: 1, max: 7 }), { minLength: 2, maxLength: 5 })
  .chain((sizes) => {
    const layers: number[][] = [];
    let next = 0;
    for (const size of sizes) {
      layers.push(Array.from({ length: size }, () => next++));
    }
    const n = next;
    const real = fc.double({ min: -3, max: 3, noNaN: true });
    return fc
      .record({
        dummy: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
        gapLeft: fc.array(fc.double({ min: 0, max: 6, noNaN: true }), {
          minLength: n,
          maxLength: n,
        }),
        links: fc.array(
          fc.record({
            rank: fc.nat({ max: 99 }),
            a: fc.nat({ max: 99 }),
            b: fc.nat({ max: 99 }),
            weight: fc.double({ min: 0.1, max: 8, noNaN: true }),
            topOffset: real,
            bottomOffset: real,
          }),
          { maxLength: 24 },
        ),
      })
      .map(({ dummy, gapLeft, links }) => ({
        layers,
        dummy,
        gapLeft,
        links: links.map((l) => {
          const upper = layers[l.rank % (layers.length - 1)];
          const lower = layers[(l.rank % (layers.length - 1)) + 1];
          return {
            top: upper[l.a % upper.length],
            bottom: lower[l.b % lower.length],
            weight: l.weight,
            topOffset: l.topOffset,
            bottomOffset: l.bottomOffset,
          };
        }),
        pulls: [],
      }));
  });

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
