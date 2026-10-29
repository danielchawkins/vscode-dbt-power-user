import type { Separation } from "../place/vpsc.js";

// Test-only: the exact optimum of a small separation problem, as an oracle for the solver.

/** Separations whose rows a smaller tolerance than this treats as dependent. */
const PIVOT_EPS = 1e-12;

/**
 * The optimum of minimise sum w_i (x_i - x0_i)^2 subject to x_to - x_from >= gap, found by enumerating active sets:
 * each subset of separations held as equalities is solved through its KKT system, and the cheapest point that meets
 * every separation exactly, with every multiplier non-negative, is the optimum. A convex problem's KKT point is its
 * global optimum, so the result is exact up to the rounding of one linear solve. Exponential in the separations, so
 * only for instances of up to about 14 separations.
 */
export function exactSeparationOptimum(
  x0: readonly number[],
  weight: readonly number[],
  seps: readonly Separation[],
): { x: number[]; cost: number } {
  let best: { x: number[]; cost: number } | undefined;
  for (let mask = 0; mask < 1 << seps.length; mask++) {
    const active = seps.filter((_, c) => (mask & (1 << c)) !== 0);
    const solved = kktPoint(x0, weight, active);
    if (solved === undefined || solved.multipliers.some((m) => m < -1e-12)) {
      continue;
    }
    const meets = seps.every(
      (s) => solved.x[s.to] - solved.x[s.from] >= s.gap - 1e-12,
    );
    if (!meets) {
      continue;
    }
    const cost = x0.reduce(
      (sum, x, i) => sum + weight[i] * (solved.x[i] - x) ** 2,
      0,
    );
    if (best === undefined || cost < best.cost) {
      best = { x: solved.x, cost };
    }
  }
  if (best === undefined) {
    throw new Error("no feasible active set: the separations contain a cycle");
  }
  return best;
}

/** The KKT point with `active` held as equalities, or undefined when their rows are dependent. */
function kktPoint(
  x0: readonly number[],
  weight: readonly number[],
  active: readonly Separation[],
): { x: number[]; multipliers: number[] } | undefined {
  const n = x0.length;
  const size = n + active.length;
  // [2W  -A^T] [x ]   [2W x0]
  // [A    0  ] [mu] = [gap  ], with mu >= 0 for x_to - x_from >= gap.
  const rows = Array.from({ length: size }, () =>
    Array.from({ length: size + 1 }, () => 0),
  );
  for (let i = 0; i < n; i++) {
    rows[i][i] = 2 * weight[i];
    rows[i][size] = 2 * weight[i] * x0[i];
  }
  active.forEach((s, r) => {
    const row = rows[n + r];
    row[s.to] = 1;
    row[s.from] = -1;
    row[size] = s.gap;
    rows[s.to][n + r] = -1;
    rows[s.from][n + r] = 1;
  });
  const solution = solve(rows, size);
  return (
    solution && { x: solution.slice(0, n), multipliers: solution.slice(n) }
  );
}

/** Solves the augmented `size` x `size` system by Gauss–Jordan elimination with partial pivoting. */
function solve(rows: number[][], size: number): number[] | undefined {
  for (let col = 0; col < size; col++) {
    const pivot = pivotRow(rows, col, size);
    if (Math.abs(rows[pivot][col]) < PIVOT_EPS) {
      return undefined;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    eliminate(rows, col, size);
  }
  return rows.map((row, i) => row[size] / row[i]);
}

/** The row at or below `col` with the largest entry in column `col`. */
function pivotRow(rows: number[][], col: number, size: number): number {
  let pivot = col;
  for (let r = col + 1; r < size; r++) {
    if (Math.abs(rows[r][col]) > Math.abs(rows[pivot][col])) {
      pivot = r;
    }
  }
  return pivot;
}

/** Clears column `col` from every row but the pivot row `col`. */
function eliminate(rows: number[][], col: number, size: number): void {
  const lead = rows[col];
  rows.forEach((row, r) => {
    const factor = r === col ? 0 : row[col] / lead[col];
    if (factor === 0) {
      return;
    }
    for (let c = col; c <= size; c++) {
      row[c] = row[c] - factor * lead[c];
    }
  });
}
