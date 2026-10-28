import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Problem } from "./problem.js";
import { solveQuadratic } from "./quadratic.js";

/**
 * Ranks of up to four nodes, at most three ranks, so that a case has at most 12 nodes. Every node has a pull, which
 * makes the objective strictly convex, and the links join adjacent ranks at random.
 */
const problemArb: fc.Arbitrary<Problem> = fc
  .array(fc.integer({ min: 1, max: 4 }), { minLength: 2, maxLength: 3 })
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
          { maxLength: 12 },
        ),
      })
      .map(({ gapLeft, pulls, links }) => ({
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
      }));
  });

/** The objective of a point, computed directly from the problem. */
function valueAt(problem: Problem, x: readonly number[]): number {
  let f = 0;
  for (const l of problem.links) {
    const diff = x[l.top] + l.topOffset - x[l.bottom] - l.bottomOffset;
    f += l.weight * diff * diff;
  }
  for (const p of problem.pulls) {
    f += p.weight * (x[p.node] - p.target) ** 2;
  }
  return f;
}

/** The row, from column c down, with the largest entry in column c. */
function largestBelow(a: number[][], c: number): number {
  let pivot = c;
  for (let r = c + 1; r < a.length; r++) {
    if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) {
      pivot = r;
    }
  }
  return pivot;
}

/** Solves a dense linear system by Gaussian elimination with partial pivoting; undefined when it is singular. */
function solveDense(matrix: number[][], rhs: number[]): number[] | undefined {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    const pivot = largestBelow(a, c);
    if (Math.abs(a[pivot][c]) < 1e-12) {
      return undefined;
    }
    [a[c], a[pivot]] = [a[pivot], a[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) {
        continue;
      }
      const factor = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) {
        a[r][k] -= factor * a[c][k];
      }
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/**
 * The least objective over the separation constraints, found densely: each subset of the constraints is taken as
 * tight, its equality-constrained problem is solved through the KKT system, and the least objective over the feasible
 * solutions is the optimum. Practical for up to about 12 nodes.
 */
function denseOptimum(problem: Problem): number {
  const n = problem.gapLeft.length;
  const Q = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const b = Array.from({ length: n }, () => 0);
  for (const l of problem.links) {
    const a = [l.top, l.bottom];
    const sign = [1, -1];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        Q[a[i]][a[j]] += 2 * l.weight * sign[i] * sign[j];
      }
      b[a[i]] += 2 * l.weight * (l.topOffset - l.bottomOffset) * sign[i];
    }
  }
  for (const p of problem.pulls) {
    Q[p.node][p.node] += 2 * p.weight;
    b[p.node] -= 2 * p.weight * p.target;
  }
  const constraints: { upper: number; lower: number; gap: number }[] = [];
  for (const layer of problem.layers) {
    layer.slice(1).forEach((v, k) => {
      constraints.push({ upper: layer[k], lower: v, gap: problem.gapLeft[v] });
    });
  }
  let best = Infinity;
  for (let mask = 0; mask < 2 ** constraints.length; mask++) {
    const tight = constraints.filter((_, q) => (mask >> q) & 1);
    const size = n + tight.length;
    const M = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i < n && j < n ? Q[i][j] : 0)),
    );
    const rhs = Array.from({ length: size }, (_, i) => (i < n ? -b[i] : 0));
    tight.forEach((c, q) => {
      M[n + q][c.lower] = 1;
      M[n + q][c.upper] = -1;
      M[c.lower][n + q] = -1;
      M[c.upper][n + q] = 1;
      rhs[n + q] = c.gap;
    });
    const sol = solveDense(M, rhs);
    if (sol === undefined) {
      continue;
    }
    const x = sol.slice(0, n);
    const feasible = constraints.every(
      (c) => x[c.lower] - x[c.upper] >= c.gap - 1e-9,
    );
    if (feasible) {
      best = Math.min(best, valueAt(problem, x));
    }
  }
  return best;
}

describe("solveQuadratic", () => {
  it("never raises the objective as the iterations go on", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const start = problem.gapLeft.map(() => 0);
        let previous = Infinity;
        for (let cap = 0; cap <= 6; cap++) {
          const { objective, iterations } = solveQuadratic(problem, start, cap);
          expect(iterations).toBeLessThanOrEqual(cap);
          expect(objective).toBeLessThanOrEqual(
            previous + 1e-9 * Math.max(1, previous),
          );
          previous = objective;
        }
      }),
    );
  });

  it("returns a point that keeps every rank separated", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const { x } = solveQuadratic(
          problem,
          problem.gapLeft.map(() => 0),
          500,
        );
        for (const layer of problem.layers) {
          layer.slice(1).forEach((v, k) => {
            expect(x[v] - x[layer[k]]).toBeGreaterThanOrEqual(
              problem.gapLeft[v] - 1e-9,
            );
          });
        }
      }),
    );
  });

  it("reaches the optimum of the dense solver on graphs of up to 12 nodes", () => {
    fc.assert(
      fc.property(problemArb, (problem) => {
        const optimum = denseOptimum(problem);
        const { objective } = solveQuadratic(
          problem,
          problem.gapLeft.map(() => 0),
          2000,
        );
        const scale = Math.max(1, optimum);
        expect(objective).toBeGreaterThanOrEqual(optimum - 1e-6 * scale);
        expect(objective).toBeLessThanOrEqual(optimum + 1e-3 * scale);
      }),
      { numRuns: 200 },
    );
  });

  it("moves a lone pulled node to its target and reports the work it took", () => {
    const problem: Problem = {
      layers: [[0]],
      gapLeft: [0],
      dummy: [false],
      links: [],
      pulls: [{ node: 0, weight: 1, target: 5 }],
    };
    const { x, iterations } = solveQuadratic(problem, [0], 100);
    expect(x[0]).toBeCloseTo(5, 9);
    expect(iterations).toBeLessThanOrEqual(100);
  });
});
