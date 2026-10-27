import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seededRandom, shuffled } from "./random.js";

describe("seededRandom", () => {
  it("gives the same sequence for the same seed", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = seededRandom(seed);
        const b = seededRandom(seed);
        for (let i = 0; i < 20; i++) {
          expect(a()).toBe(b());
        }
      }),
      { numRuns: 200 },
    );
  });

  it("draws values in [0, 1)", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const next = seededRandom(seed);
        for (let i = 0; i < 50; i++) {
          const x = next();
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(1);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe("shuffled", () => {
  it("returns a permutation of its input, leaving the input alone", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), (items, seed) => {
        const copy = [...items];
        const out = shuffled(items, seededRandom(seed));
        expect(out.toSorted((a, b) => a - b)).toEqual(
          items.toSorted((a, b) => a - b),
        );
        expect(items).toEqual(copy);
      }),
      { numRuns: 200 },
    );
  });
});
