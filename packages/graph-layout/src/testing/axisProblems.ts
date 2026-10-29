import fc from "fast-check";
import type { AxisProblem, Separation } from "../constraints/types.js";

// Test-only: random axis problems that are feasible by construction. Each one is built around a point that satisfies
// every separation and equality, so a solution must exist; the point also bounds the optimum from above.

export interface FeasibleAxis {
  problem: AxisProblem;
  /** A point that satisfies every constraint of `problem`. */
  point: number[];
}

const pairArb = (n: number) =>
  fc.tuple(fc.nat(n - 1), fc.nat(n - 1)).filter(([a, b]) => a !== b);

/** Up to `n` variables, with equalities and separations among them, and a feasible point. */
export const feasibleAxisArb: fc.Arbitrary<FeasibleAxis> = fc
  .integer({ min: 2, max: 8 })
  .chain((n) =>
    fc.tuple(
      fc.array(fc.integer({ min: 0, max: 20 }), {
        minLength: n,
        maxLength: n,
      }),
      fc.array(fc.integer({ min: 0, max: 20 }), {
        minLength: n,
        maxLength: n,
      }),
      fc.array(fc.integer({ min: 1, max: 4 }), { minLength: n, maxLength: n }),
      fc.array(pairArb(n), { maxLength: 2 }),
      fc.array(fc.tuple(pairArb(n), fc.integer({ min: 0, max: 3 })), {
        maxLength: 10,
      }),
    ),
  )
  .map(([point, desired, weight, equal, ordered]) => {
    const separations: Separation[] = [
      ...equal.map(([from, to]) => ({
        from,
        to,
        gap: (point[to] ?? 0) - (point[from] ?? 0),
        equality: true,
      })),
      ...ordered.map(([[from, to], slack]) => ({
        from,
        to,
        gap: (point[to] ?? 0) - (point[from] ?? 0) - slack,
      })),
    ];
    return {
      problem: { desired, weight, separations },
      point,
    };
  });
