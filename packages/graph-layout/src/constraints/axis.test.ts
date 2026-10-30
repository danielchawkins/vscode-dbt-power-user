import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { solveSeparations } from "../place/vpsc.js";
import { feasibleAxisArb } from "../testing/axisProblems.js";
import { projectAxis } from "./axis.js";
import { components } from "./components.js";
import type { AxisProblem } from "./types.js";

/**
 * Whether the separations, with equal variables merged, form a cycle: an inequality between two classes lies in one
 * strongly connected component of the graph that counts each equality in both directions.
 */
function mergedCycle(problem: AxisProblem): boolean {
  const n = problem.desired.length;
  const both = ({ from, to }: { from: number; to: number }) => [
    [from, to] as const,
    [to, from] as const,
  ];
  const equalities = problem.separations.filter((s) => s.equality === true);
  const classOf = components(n, equalities.flatMap(both));
  const comp = components(
    n,
    problem.separations.flatMap((s) =>
      s.equality === true ? both(s) : [[s.from, s.to] as const],
    ),
  );
  return problem.separations.some(
    (s) =>
      s.equality !== true &&
      classOf[s.from] !== classOf[s.to] &&
      comp[s.from] === comp[s.to],
  );
}

/** The projection, or `undefined` when the merged separations form a cycle, which `projectAxis` must then reject. */
function projectedOrCycle(problem: AxisProblem): number[] | undefined {
  if (mergedCycle(problem)) {
    expect(() => projectAxis(problem)).toThrow(
      /cycle once equal variables are merged|directed cycle/,
    );
    return undefined;
  }
  return projectAxis(problem);
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
        if (x === undefined) {
          return;
        }
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
    ).toThrow(
      /equalities contradict each other: c is forced 6 from a through b/,
    );
  });

  it("names the variables of a DAG that merging its equal variables turns into a cycle", () => {
    // x1 = x0 + 3, and x0 + 1 <= x2 <= x1 - 1: a feasible DAG, but merging x0 and x1 closes a cycle through x2.
    expect(() =>
      projectAxis({
        desired: [0, 0, 0],
        weight: [1, 1, 1],
        names: ["p", "q", "r"],
        separations: [
          { from: 0, to: 1, gap: 3, equality: true },
          { from: 0, to: 2, gap: 1 },
          { from: 2, to: 1, gap: 1 },
        ],
      }),
    ).toThrow(
      /cycle once equal variables are merged, which the solver cannot take: p, q, r/,
    );
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
