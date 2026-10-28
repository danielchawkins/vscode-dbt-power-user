import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Constraint, Solver, Variable } from "../testing/webcolaVpsc.js";
import { type Separation, solveSeparations } from "./vpsc.js";

// Differential oracle: solveSeparations against WebCola's vpsc.ts (MIT, vendored in src/testing) on seeded DAGs.

/** Fixed seed, so every run draws the same instances. */
const SEED = 20_240_611;
/** Relative tolerance on the objective, with an absolute floor of 1 so that a near-zero optimum is compared absolutely. */
const COST_TOLERANCE = 1e-6;
/** Largest violation of a separation that either solver may leave. */
const SLACK_TOLERANCE = 1e-9;
/** Passes of WebCola's satisfy() allowed before the driver gives up. */
const MAX_PASSES = 10_000;
/**
 * Consecutive passes whose cost must not move before WebCola is taken as optimal. One pass is not enough: a pass
 * that only splits blocks leaves the cost unchanged while the solution is still improving.
 */
const STABLE_PASSES = 20;

interface Instance {
  x0: number[];
  weight: number[];
  seps: Separation[];
}

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true });

/** Builds separations between lower and higher indices, each tight, redundant or free. */
function separate(
  x0: readonly number[],
  pairs: readonly (readonly [number, number, number, number])[],
): Separation[] {
  return pairs.flatMap(([a, b, kind, u]): Separation[] => {
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
  });
}

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
    seps: separate(x0, pairs),
  }));

/**
 * Integer data on a small range, so that targets tie, gaps coincide with distances and weights repeat. These are the
 * cases where a block merge or split decision is exactly on the boundary.
 */
const degenerateArb: fc.Arbitrary<Instance> = fc
  .integer({ min: 2, max: 40 })
  .chain((n) =>
    fc.tuple(
      fc.array(fc.integer({ min: -4, max: 4 }), { minLength: n, maxLength: n }),
      fc.array(fc.integer({ min: 1, max: 2 }), { minLength: n, maxLength: n }),
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: n - 1 }),
          fc.integer({ min: 0, max: n - 1 }),
          fc.integer({ min: 0, max: 2 }),
          fc.constant(0.5),
        ),
        { minLength: n, maxLength: 3 * n },
      ),
    ),
  )
  .map(([x0, weight, pairs]) => ({
    x0,
    weight,
    seps: separate(x0, pairs).map((s) => ({ ...s, gap: Math.round(s.gap) })),
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

/** WebCola's solution, iterated until its cost has held still for STABLE_PASSES passes. */
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
  let stable = 0;
  for (let pass = 0; pass < MAX_PASSES && stable < STABLE_PASSES; pass++) {
    solver.satisfy();
    const cost = objective(inst, vs.map((v) => v.position()));
    stable =
      Math.abs(cost - previous) <= 1e-12 * Math.max(1, Math.abs(cost))
        ? stable + 1
        : 0;
    previous = cost;
  }
  return {
    x: vs.map((v) => v.position()),
    unsatisfiable: cs.filter((c) => c.unsatisfiable).length,
    converged: stable >= STABLE_PASSES,
  };
}

/** A description of how the two solvers disagree on this instance, or null when they agree. */
function disagreement(inst: Instance): string | null {
  let ours: number[];
  try {
    ours = solveSeparations(inst.x0, inst.weight, inst.seps);
  } catch (error) {
    return `solveSeparations threw: ${String(error)}`;
  }
  const reference = webcola(inst);
  if (!reference.converged) {
    return "WebCola did not converge";
  }
  if (reference.unsatisfiable > 0) {
    return "WebCola flagged a DAG";
  }
  const mine = objective(inst, ours);
  const theirs = objective(inst, reference.x);
  const scale = Math.max(1, Math.abs(mine), Math.abs(theirs));
  if (Math.abs(mine - theirs) / scale > COST_TOLERANCE) {
    return `cost ${mine} against WebCola's ${theirs}`;
  }
  if (worstSlack(inst.seps, ours) < -SLACK_TOLERANCE) {
    return `our solution violates a separation by ${-worstSlack(inst.seps, ours)}`;
  }
  if (worstSlack(inst.seps, reference.x) < -SLACK_TOLERANCE) {
    return "WebCola's solution violates a separation";
  }
  return null;
}

/** Drops separations one at a time while the disagreement persists, giving a minimal counterexample. */
function minimise(inst: Instance): Instance {
  let current = inst;
  for (let i = inst.seps.length - 1; i >= 0; i--) {
    const candidate = {
      ...current,
      seps: current.seps.filter((_, j) => j !== i),
    };
    if (disagreement(candidate) !== null) {
      current = candidate;
    }
  }
  return current;
}

/** Fails with the reason and the minimal counterexample when the two solvers disagree. */
function assertAgree(inst: Instance): void {
  const reason = disagreement(inst);
  if (reason !== null) {
    throw new Error(
      `${reason}\nminimal counterexample: ${JSON.stringify(minimise(inst))}`,
    );
  }
}

describe("solveSeparations against WebCola's vpsc", () => {
  it("reaches the same cost, and satisfies every separation, on seeded random DAGs of up to 200 variables", () => {
    fc.assert(
      fc.property(instanceArb, (inst) => {
        assertAgree(inst);
        return true;
      }),
      { seed: SEED, numRuns: 100 },
    );
  }, 120_000);

  it("agrees on degenerate integer DAGs, where ties and boundary decisions are common", () => {
    fc.assert(
      fc.property(degenerateArb, (inst) => {
        assertAgree(inst);
        return true;
      }),
      { seed: SEED + 1, numRuns: 200 },
    );
  }, 120_000);
});
