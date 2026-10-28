import { describe, expect, it } from "vitest";
import { type Case, cases } from "../testing/msaglCases.js";
import { chainCases } from "../testing/msaglChains.js";
import { type Separation, solveSeparations } from "./vpsc.js";

/** MSAGL prints expected positions to five significant digits, so the comparison is looser than the solver's own. */
const POSITION_TOLERANCE = 1e-4;

/** The weighted squared distance moved from the desired positions. */
function goalOf(c: Case, x: readonly number[]): number {
  return c.desired.reduce(
    (sum, d, i) => sum + (c.weight?.[i] ?? 1) * ((x[i] ?? 0) - d) ** 2,
    0,
  );
}

/** Converts a ported case into the solver's input. */
function separationsOf(c: Case): Separation[] {
  return c.seps.map(([from, to, gap]) => ({ from, to, gap }));
}

describe("solveSeparations on MSAGL's inequality cases", () => {
  for (const c of [...cases, ...chainCases]) {
    it(`${c.name}`, () => {
      const weight = c.weight ?? c.desired.map(() => 1);
      const x = solveSeparations(c.desired, weight, separationsOf(c));
      c.expected.forEach((value, i) => {
        expect(Math.abs((x[i] ?? Number.NaN) - value)).toBeLessThanOrEqual(
          POSITION_TOLERANCE,
        );
      });
      if (c.goal !== undefined) {
        expect(goalOf(c, x)).toBeCloseTo(c.goal, 6);
      }
    });
  }

  // MSAGL's Test_Unsatisfiable_Direct_Inequality expects one unsatisfiable constraint and carries on. This solver's
  // contract is different: a directed cycle is rejected with an error that names it.
  it("rejects the unsatisfiable direct inequality cycle (MSAGL Test_Unsatisfiable_Direct_Inequality)", () => {
    expect(() =>
      solveSeparations(
        [1, 2],
        [1, 1],
        [
          { from: 0, to: 1, gap: 2 },
          { from: 1, to: 0, gap: 3 },
        ],
      ),
    ).toThrow(/directed cycle: (0 -> 1 -> 0|1 -> 0 -> 1)/);
  });

  it("rejects the indirect cycle with a single constraint per variable (MSAGL Test_Unsatisfiable_Cycle_Indirect_With_SingleConstraint_Var)", () => {
    expect(() =>
      solveSeparations(
        [1, 2, 3],
        [1, 1, 1],
        [
          { from: 0, to: 1, gap: 4 },
          { from: 1, to: 2, gap: 4 },
          { from: 2, to: 1, gap: 4 },
        ],
      ),
    ).toThrow(/directed cycle: (1 -> 2 -> 1|2 -> 1 -> 2)/);
  });
});
