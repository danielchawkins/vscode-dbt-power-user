import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveSeparations } from "../place/vpsc.js";
import { feasibleAxisArb } from "../testing/axisProblems.js";
import { projectAxis } from "./axis.js";
import type { AxisProblem } from "./types.js";

/** The projection, or `undefined` when the separations form a cycle (the fixture does not rule one out). */
function projectedOrCycle(problem: AxisProblem): number[] | undefined {
  try {
    return projectAxis(problem);
  } catch (error) {
    if (error instanceof Error && error.message.includes("directed cycle")) {
      return undefined;
    }
    throw error;
  }
}

function cost(problem: AxisProblem, x: readonly number[]): number {
  return problem.desired.reduce(
    (sum, d, v) => sum + problem.weight[v] * (x[v] - d) ** 2,
    0,
  );
}

describe("projectAxis", () => {
  it("holds every separation and equality, and is no further from the desired positions than a feasible point", () => {
    fc.assert(
      fc.property(feasibleAxisArb, ({ problem, point }) => {
        const x = projectedOrCycle(problem);
        fc.pre(x !== undefined);
        for (const s of problem.separations) {
          const diff = x[s.to] - x[s.from];
          if (s.equality) {
            expect(Math.abs(diff - s.gap)).toBeLessThan(1e-7);
          } else {
            expect(diff).toBeGreaterThanOrEqual(s.gap - 1e-7);
          }
        }
        expect(cost(problem, x)).toBeLessThanOrEqual(
          cost(problem, point) + 1e-7,
        );
      }),
      { numRuns: 300 },
    );
  });

  it("gives the solver's own answer when there are no equalities", () => {
    fc.assert(
      fc.property(feasibleAxisArb, ({ problem }) => {
        const plain: AxisProblem = {
          ...problem,
          separations: problem.separations.filter((s) => !s.equality),
        };
        let expected: number[] | undefined;
        try {
          expected = solveSeparations(
            plain.desired,
            plain.weight,
            plain.separations,
          );
        } catch {
          expected = undefined;
        }
        fc.pre(expected !== undefined);
        expect(projectAxis(plain)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("holds an equality at the weighted mean of its members' desired positions", () => {
    const x = projectAxis({
      desired: [0, 10],
      weight: [1, 3],
      separations: [{ from: 0, to: 1, gap: 2, equality: true }],
    });
    // x1 = x0 + 2, so the class sits where (0 - 0) * 1 + (10 - 2) * 3 is balanced: x0 = 6, x1 = 8.
    expect(x).toEqual([6, 8]);
  });

  it("solves an alignment that is also separated from another node", () => {
    const x = projectAxis({
      desired: [0, 0, 5],
      weight: [1, 1, 1],
      separations: [
        { from: 0, to: 1, gap: 0, equality: true },
        { from: 1, to: 2, gap: 4 },
      ],
    });
    expect(x[0]).toBe(x[1]);
    expect(x[2] - x[1]).toBeGreaterThanOrEqual(4 - 1e-9);
  });

  it("reports a contradictory equality cycle by the names of its variables", () => {
    // a + 3 = b, b + 3 = c, and a + 9 = c: the last equality contradicts the first two.
    expect(() =>
      projectAxis({
        desired: [0, 0, 0],
        weight: [1, 1, 1],
        names: ["a", "b", "c"],
        separations: [
          { from: 0, to: 1, gap: 3, equality: true },
          { from: 1, to: 2, gap: 3, equality: true },
          { from: 0, to: 2, gap: 9, equality: true },
        ],
      }),
    ).toThrow(/equalities contradict each other: .* and .* are forced/);
  });

  it("names a separation that cannot hold between two equal variables", () => {
    expect(() =>
      projectAxis({
        desired: [0, 0],
        weight: [1, 1],
        names: ["left", "right"],
        separations: [
          { from: 0, to: 1, gap: 0, equality: true },
          { from: 0, to: 1, gap: 5 },
        ],
      }),
    ).toThrow(/separation of 5 from left to right cannot hold/);
  });

  it("reports a directed cycle of separations rather than looping", () => {
    expect(() =>
      projectAxis({
        desired: [0, 0],
        weight: [1, 1],
        separations: [
          { from: 0, to: 1, gap: 1 },
          { from: 1, to: 0, gap: 1 },
        ],
      }),
    ).toThrow(/directed cycle/);
  });

  it("rejects an index outside the variables", () => {
    expect(() =>
      projectAxis({
        desired: [0],
        weight: [1],
        separations: [{ from: 0, to: 1, gap: 1, equality: true }],
      }),
    ).toThrow(RangeError);
  });
});
