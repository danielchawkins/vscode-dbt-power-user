import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectRanks } from "./projection.js";
import { type Separation, solveSeparations } from "./vpsc.js";

/** Tolerance for feasibility and for the objective comparison. */
const TOLERANCE = 1e-7;

interface Instance {
  x0: number[];
  weight: number[];
  seps: Separation[];
}

/** Reads element i as a number; a missing element yields NaN, which fails every comparison. */
function at(xs: readonly number[], i: number): number {
  return xs[i] ?? Number.NaN;
}

/** The weighted squared distance moved from the targets. */
function objective(inst: Instance, x: readonly number[]): number {
  let sum = 0;
  inst.x0.forEach((x0, i) => {
    sum += at(inst.weight, i) * (at(x, i) - x0) ** 2;
  });
  return sum;
}

/** Whether every separation holds within `tol`. */
function feasible(
  seps: readonly Separation[],
  x: readonly number[],
  tol: number,
): boolean {
  return seps.every((s) => at(x, s.to) - at(x, s.from) >= s.gap - tol);
}

/**
 * Hildreth's dual coordinate ascent, an independent reference: it never touches blocks. The dual is maximised over
 * the multipliers of the separations, each non-negative; the primal point is x0 + W^-1 A^T lambda.
 */
function hildreth(inst: Instance): number[] {
  const { x0, weight, seps } = inst;
  const lambda = seps.map(() => 0);
  const displacement = x0.map(() => 0);
  for (let sweep = 0; sweep < 20000; sweep++) {
    let change = 0;
    seps.forEach((s, c) => {
      const residual = s.gap - (at(x0, s.to) - at(x0, s.from));
      const diagonal = 1 / at(weight, s.to) + 1 / at(weight, s.from);
      const gradient =
        residual - (at(displacement, s.to) - at(displacement, s.from));
      const next = Math.max(0, at(lambda, c) + gradient / diagonal);
      const delta = next - at(lambda, c);
      lambda[c] = next;
      displacement[s.to] = at(displacement, s.to) + delta / at(weight, s.to);
      displacement[s.from] =
        at(displacement, s.from) - delta / at(weight, s.from);
      change = Math.max(change, Math.abs(delta));
    });
    if (change < 1e-14) {
      break;
    }
  }
  return x0.map((x, i) => x + at(displacement, i));
}

/** A deterministic generator in [0, 1), so the timing case is repeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true });

/** A random DAG: separations only run from a lower to a higher index, in random order. */
function dagArb(maxN: number, maxSeps: number): fc.Arbitrary<Instance> {
  return fc.integer({ min: 2, max: maxN }).chain((n) =>
    fc
      .tuple(
        fc.array(finite(-5, 5), { minLength: n, maxLength: n }),
        fc.array(finite(0.1, 5), { minLength: n, maxLength: n }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: n - 1 }),
            fc.integer({ min: 0, max: n - 1 }),
            finite(-2, 3),
          ),
          { maxLength: maxSeps },
        ),
      )
      .map(([x0, weight, pairs]) => ({
        x0,
        weight,
        seps: pairs
          .filter(([a, b]) => a !== b)
          .map(([a, b, gap]) => ({
            from: Math.min(a, b),
            to: Math.max(a, b),
            gap,
          })),
      })),
  );
}

describe("solveSeparations", () => {
  it("matches the exact chain projection of projectRanks", () => {
    const chainArb = fc
      .integer({ min: 1, max: 25 })
      .chain((n) =>
        fc.tuple(
          fc.array(finite(-20, 20), { minLength: n, maxLength: n }),
          fc.array(finite(0.1, 5), { minLength: n, maxLength: n }),
          fc.array(finite(0, 5), { minLength: n, maxLength: n }),
        ),
      );
    fc.assert(
      fc.property(chainArb, ([x0, weight, gapLeft]) => {
        const n = x0.length;
        const layers = [Array.from({ length: n }, (_, i) => i)];
        const expected = [...x0];
        projectRanks({ layers, gapLeft }, expected, weight);
        const seps: Separation[] = [];
        for (let k = 1; k < n; k++) {
          seps.push({ from: k - 1, to: k, gap: at(gapLeft, k) });
        }
        const actual = solveSeparations(x0, weight, seps);
        actual.forEach((value, i) => {
          expect(Math.abs(value - at(expected, i))).toBeLessThanOrEqual(
            TOLERANCE,
          );
        });
      }),
      { numRuns: 150 },
    );
  });

  it("reaches the optimum of small random DAGs, as certified by the reference", () => {
    fc.assert(
      fc.property(dagArb(8, 12), (inst) => {
        const x = solveSeparations(inst.x0, inst.weight, inst.seps);
        expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
        const reference = hildreth(inst);
        // Hildreth's primal point bounds the optimum only when it is feasible: on a near-degenerate gap it can stop
        // short of convergence, and its objective then lies below the optimum. That case is pinned below instead.
        if (feasible(inst.seps, reference, TOLERANCE)) {
          expect(objective(inst, x)).toBeLessThanOrEqual(
            objective(inst, reference) + TOLERANCE,
          );
        }
      }),
      { numRuns: 150 },
    );
  });

  it("keeps every separation on random DAGs of up to 300 variables", () => {
    fc.assert(
      fc.property(dagArb(300, 900), (inst) => {
        const x = solveSeparations(inst.x0, inst.weight, inst.seps);
        expect(x).toHaveLength(inst.x0.length);
        expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("solves the near-degenerate instance that stops Hildreth short of convergence", () => {
    // Exact optimum from enumerating the active sets and checking KKT: 0->1 and 1->2 are tight, all three at x0 ~ 0.00638.
    const inst: Instance = {
      x0: [0.013873527966563645, 0, 0],
      weight: [1.904696304361651, 0.1, 2.1392397072944345],
      seps: [
        { from: 0, to: 1, gap: 0 },
        { from: 0, to: 2, gap: -0.000003657608469727521 },
        { from: 1, to: 2, gap: 0 },
      ],
    };
    const x = solveSeparations(inst.x0, inst.weight, inst.seps);
    expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
    expect(objective(inst, x)).toBeLessThanOrEqual(
      0.0001981012030891248 + TOLERANCE,
    );
  });

  it("solves a crossing of two blocks whose merge closes a cycle of blocks", () => {
    // a=0, b=1, c=2, d=3: a<b and c<d are merged first, then a<d and c<b cross the two blocks.
    const inst: Instance = {
      x0: [0, 0, 0, 0],
      weight: [1, 1, 1, 1],
      seps: [
        { from: 0, to: 1, gap: 1 },
        { from: 2, to: 3, gap: 1 },
        { from: 0, to: 3, gap: 0.5 },
        { from: 2, to: 1, gap: 0.5 },
      ],
    };
    const x = solveSeparations(inst.x0, inst.weight, inst.seps);
    expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
    expect(objective(inst, x)).toBeLessThanOrEqual(
      objective(inst, hildreth(inst)) + TOLERANCE,
    );
  });

  it("solves 2000 variables with a chain and random separations within the time limit", () => {
    const rand = seeded(7);
    const n = 2000;
    const x0 = Array.from({ length: n }, () => rand() * 100);
    const weight = Array.from({ length: n }, () => 0.1 + rand() * 4.9);
    const seps: Separation[] = [];
    for (let i = 0; i + 1 < n; i++) {
      seps.push({ from: i, to: i + 1, gap: rand() });
    }
    for (let k = 0; k < 3000; k++) {
      const a = Math.floor(rand() * n);
      const b = Math.floor(rand() * n);
      if (a < b) {
        seps.push({ from: a, to: b, gap: rand() * 3 - 1 });
      }
    }
    const x = solveSeparations(x0, weight, seps);
    expect(feasible(seps, x, TOLERANCE)).toBe(true);
  }, 120_000);

  it("leaves a self-separation with a non-positive gap out of the problem", () => {
    const x = solveSeparations([1, 2], [1, 1], [{ from: 0, to: 0, gap: -1 }]);
    expect(x).toEqual([1, 2]);
  });

  it("rejects a self-separation with a positive gap", () => {
    expect(() =>
      solveSeparations([1, 2], [1, 1], [{ from: 1, to: 1, gap: 0.5 }]),
    ).toThrow(/cannot be separated from itself/);
  });

  it("rejects a directed cycle of separations, naming it", () => {
    expect(() =>
      solveSeparations(
        [0, 0],
        [1, 1],
        [
          { from: 0, to: 1, gap: 1 },
          { from: 1, to: 0, gap: 1 },
        ],
      ),
    ).toThrow(/directed cycle: [01] -> [01] -> [01]/);
  });
});
