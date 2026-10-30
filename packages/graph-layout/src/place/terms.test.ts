import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Problem } from "./problem.js";
import { solveQuadratic } from "./quadratic.js";
import { termsOf, termValue } from "./terms.js";

/**
 * Random placement problems with links between adjacent ranks and a pull on every node, so the objective is strictly
 * convex. The offsets and weights take both signs, so no term is trivially zero.
 */
const problemArb: fc.Arbitrary<Problem> = fc
  .array(fc.integer({ min: 1, max: 5 }), { minLength: 2, maxLength: 4 })
  .chain((sizes) => {
    const layers: number[][] = [];
    let next = 0;
    for (const size of sizes) {
      layers.push(Array.from({ length: size }, () => next++));
    }
    const n = next;
    const real = (min: number, max: number) =>
      fc.double({ min, max, noNaN: true });
    return fc
      .record({
        gapLeft: fc.array(real(0, 4), { minLength: n, maxLength: n }),
        pulls: fc.array(
          fc.record({ weight: real(0.05, 2), target: real(-10, 10) }),
          {
            minLength: n,
            maxLength: n,
          },
        ),
        links: fc.array(
          fc.record({
            rank: fc.nat({ max: 99 }),
            a: fc.nat({ max: 99 }),
            b: fc.nat({ max: 99 }),
            weight: real(0.1, 8),
            topOffset: real(-3, 3),
            bottomOffset: real(-3, 3),
          }),
          { maxLength: 16 },
        ),
        start: fc.array(real(-20, 20), { minLength: n, maxLength: n }),
      })
      .map(({ gapLeft, pulls, links, start }) => ({
        problem: {
          layers,
          gapLeft,
          dummy: gapLeft.map(() => false),
          links: links.map((l) => {
            const r = l.rank % (layers.length - 1);
            const upper = layers[r];
            const lower = layers[r + 1];
            return {
              top: upper[l.a % upper.length],
              bottom: lower[l.b % lower.length],
              weight: l.weight,
              topOffset: l.topOffset,
              bottomOffset: l.bottomOffset,
            };
          }),
          pulls: pulls.map((p, node) => ({ node, ...p })),
        } satisfies Problem,
        start,
      }));
  });

/** The objective of a point, written out from the problem as it was before the term list: links, then pulls. */
function valueAt(problem: Problem, x: readonly number[]): number {
  let f = 0;
  for (const l of problem.links) {
    const diff = x[l.top] + l.topOffset - x[l.bottom] - l.bottomOffset;
    f += l.weight * diff * diff;
  }
  for (const p of problem.pulls) {
    const diff = x[p.node] - p.target;
    f += p.weight * diff * diff;
  }
  return f;
}

describe("placement terms", () => {
  it("sum to the objective the solver reports, bit for bit, on random problems", () => {
    fc.assert(
      fc.property(problemArb, ({ problem, start }) => {
        const x = [...start];
        const summed = termsOf(problem).reduce(
          (f, term) => f + termValue(term, x),
          0,
        );
        expect(summed).toBe(valueAt(problem, x));

        const solution = solveQuadratic(problem, start, 50);
        expect(solution.objective).toBe(valueAt(problem, solution.x));
      }),
      { numRuns: 200 },
    );
  });

  it("list every link and then every pull, in the order the sums run", () => {
    fc.assert(
      fc.property(problemArb, ({ problem }) => {
        const terms = termsOf(problem);
        expect(terms.map((t) => t.kind)).toEqual([
          ...problem.links.map(() => "link"),
          ...problem.pulls.map(() => "pull"),
        ]);
      }),
      { numRuns: 100 },
    );
  });
});
