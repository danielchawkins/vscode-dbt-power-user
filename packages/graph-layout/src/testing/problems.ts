import fc from "fast-check";
import type { Problem } from "../place/problem.js";

// Test-only: random in-rank placement problems, shared by the Brandes–Köpf tests.

/** Ranks of 1 to 7 nodes, up to five ranks, with sparse random links between adjacent ranks and random gaps, dummies and port offsets. */
export const problemArb: fc.Arbitrary<Problem> = fc
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
