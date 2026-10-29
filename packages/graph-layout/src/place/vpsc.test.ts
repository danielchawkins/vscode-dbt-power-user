import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exactSeparationOptimum } from "../testing/exactSeparations.js";
import { projectRanks } from "./projection.js";
import { type Separation, solveSeparations } from "./vpsc.js";

/** Tolerance for feasibility. */
const TOLERANCE = 1e-7;
/** `VIOLATION_TOLERANCE` in vpsc.ts: the solver treats a separation as held once its slack is above minus this. */
const SOLVER_SLACK = 1e-9;
/** Relative rounding allowed between two computations of the same optimum. */
const ROUNDING = 1e-12;

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
 * Checks that `x` is optimal within the solver's slack: it costs no more than the exact optimum, and no less than the
 * exact optimum of the same problem with every gap relaxed by that slack, which `x` also satisfies.
 */
function expectOptimal(inst: Instance, x: readonly number[]): void {
  expect(feasible(inst.seps, x, SOLVER_SLACK)).toBe(true);
  const cost = objective(inst, x);
  const exact = exactSeparationOptimum(inst.x0, inst.weight, inst.seps).cost;
  const relaxed = exactSeparationOptimum(
    inst.x0,
    inst.weight,
    inst.seps.map((s) => ({ ...s, gap: s.gap - SOLVER_SLACK })),
  ).cost;
  expect(cost).toBeLessThanOrEqual(exact + ROUNDING * (1 + exact));
  expect(cost).toBeGreaterThanOrEqual(relaxed - ROUNDING * (1 + relaxed));
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

  it("reaches the exact optimum of small random DAGs", () => {
    fc.assert(
      fc.property(dagArb(8, 12), (inst) => {
        const x = solveSeparations(inst.x0, inst.weight, inst.seps);
        expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
        expectOptimal(inst, x);
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
    expectOptimal(inst, x);
  });

  it("reaches the exact optimum on near-degenerate gaps", () => {
    // Gaps of 1e-8 and -4e-6 sit beside zero gaps, so blocks merge and split at the edge of the solver's tolerance.
    const cases: Instance[] = [
      {
        x0: [0.013873527966563645, 0, 0],
        weight: [1.904696304361651, 0.1, 2.1392397072944345],
        seps: [
          { from: 0, to: 1, gap: 0 },
          { from: 0, to: 2, gap: -0.000003657608469727521 },
          { from: 1, to: 2, gap: 0 },
        ],
      },
      {
        x0: [0, 0, 0, 0, -1.347071049676007],
        weight: [
          1.8629733620456534, 1.2509341814626576, 0.10000000000000009, 0.1,
          2.9443436692296747,
        ],
        seps: [
          { from: 1, to: 4, gap: 0 },
          { from: 0, to: 4, gap: 0 },
          { from: 1, to: 3, gap: 2.4937342579800518e-8 },
          { from: 0, to: 3, gap: 0 },
          { from: 0, to: 1, gap: 0 },
          { from: 0, to: 3, gap: 0 },
          { from: 3, to: 4, gap: 0 },
        ],
      },
    ];
    for (const inst of cases) {
      const x = solveSeparations(inst.x0, inst.weight, inst.seps);
      expect(feasible(inst.seps, x, TOLERANCE)).toBe(true);
      expectOptimal(inst, x);
    }
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
