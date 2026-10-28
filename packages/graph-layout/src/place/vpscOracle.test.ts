import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Constraint, Solver, Variable } from "../testing/webcolaVpsc.js";
import { type Separation, solveSeparations } from "./vpsc.js";

// Differential oracle: solveSeparations against WebCola's vpsc.ts (MIT, vendored in src/testing) on seeded random DAGs.

/** Fixed seed, so every run draws the same instances. */
const SEED = 20_240_611;
/** Relative tolerance on the objective, with an absolute floor of 1 so that a near-zero optimum is compared absolutely. */
const COST_TOLERANCE = 1e-6;
/** Largest violation of a separation that either solver may leave. */
const SLACK_TOLERANCE = 1e-9;
/** WebCola's own stopping test is 1e-4 on the cost; this driver iterates until the cost stops moving. */
const MAX_PASSES = 10_000;

interface Instance {
  x0: number[];
  weight: number[];
  seps: Separation[];
}

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true });

/**
 * A random DAG on 2 to 200 variables with 3n separations at most. Each separation runs from a lower to a higher index,
 * and its gap is one of three kinds: tight (close to the current distance, so it binds), redundant (well below it),
 * or free (any gap in -3..3). Weights are mixed over two decades.
 */
const instanceArb: fc.Arbitrary<Instance> = fc
  .integer({ min: 2, max: 200 })
  .chain((n) =>
    fc.tuple(
      fc.array(finite(-50, 50), { minLength: n, maxLength: n }),
      fc.array(finite(0.01, 5), { minLength: n, maxLength: n }),
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: n - 1 }),
          fc.integer({ min: 0, max: n - 1 }),
          fc.integer({ min: 0, max: 2 }),
          finite(0, 1),
        ),
        { minLength: n, maxLength: 3 * n },
      ),
    ),
  )
  .map(([x0, weight, pairs]) => ({
    x0,
    weight,
    seps: pairs.flatMap(([a, b, kind, u]): Separation[] => {
      if (a === b) {
        return [];
      }
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      const distance = (x0[to] ?? 0) - (x0[from] ?? 0);
      const gap =
        kind === 0
          ? distance + (u - 0.5) * 0.2
          : kind === 1
            ? distance - u * 2
            : u * 6 - 3;
      return [{ from, to, gap }];
    }),
  }));

/** The weighted squared distance moved from the targets. */
function objective(inst: Instance, x: readonly number[]): number {
  return inst.x0.reduce(
    (sum, x0, i) => sum + (inst.weight[i] ?? 0) * ((x[i] ?? 0) - x0) ** 2,
    0,
  );
}

/** The largest violation among the separations; zero or positive when all hold. */
function worstSlack(seps: readonly Separation[], x: readonly number[]): number {
  return seps.reduce(
    (worst, s) =>
      Math.min(worst, (x[s.to] ?? 0) - (x[s.from] ?? 0) - s.gap),
    Number.POSITIVE_INFINITY,
  );
}

/** WebCola's solution, iterated until its cost stops moving, with the count of constraints it could not satisfy. */
function webcola(inst: Instance): {
  x: number[];
  unsatisfiable: number;
  converged: boolean;
} {
  const vs = inst.x0.map((x0, i) => new Variable(x0, inst.weight[i]));
  const cs = inst.seps.map(
    (s) => new Constraint(vs[s.from]!, vs[s.to]!, s.gap),
  );
  const solver = new Solver(vs, cs);
  let previous = Number.NaN;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    solver.satisfy();
    const cost = objective(inst, vs.map((v) => v.position()));
    if (Math.abs(cost - previous) <= 1e-12 * Math.max(1, Math.abs(cost))) {
      return {
        x: vs.map((v) => v.position()),
        unsatisfiable: cs.filter((c) => c.unsatisfiable).length,
        converged: true,
      };
    }
    previous = cost;
  }
  return {
    x: vs.map((v) => v.position()),
    unsatisfiable: cs.filter((c) => c.unsatisfiable).length,
    converged: false,
  };
}

describe("solveSeparations against WebCola's vpsc", () => {
  it("reaches the same cost, and satisfies every separation, on seeded random DAGs of up to 200 variables", () => {
    fc.assert(
      fc.property(instanceArb, (inst) => {
        const ours = solveSeparations(inst.x0, inst.weight, inst.seps);
        const reference = webcola(inst);
        expect(reference.converged, "WebCola did not converge").toBe(true);
        expect(reference.unsatisfiable, "WebCola flagged a DAG").toBe(0);

        const mine = objective(inst, ours);
        const theirs = objective(inst, reference.x);
        const scale = Math.max(1, Math.abs(mine), Math.abs(theirs));
        expect(Math.abs(mine - theirs) / scale).toBeLessThanOrEqual(
          COST_TOLERANCE,
        );
        expect(worstSlack(inst.seps, ours)).toBeGreaterThanOrEqual(
          -SLACK_TOLERANCE,
        );
        expect(worstSlack(inst.seps, reference.x)).toBeGreaterThanOrEqual(
          -SLACK_TOLERANCE,
        );
      }),
      { seed: SEED, numRuns: 100 },
    );
  }, 120_000);
});
