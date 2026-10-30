import type { Problem } from "./problem.js";
import { project } from "./projection.js";
import {
  addDiagonal,
  addGradient,
  addHessian,
  type Term,
  termsOf,
  termValue,
} from "./terms.js";

/** A step that lowers the objective by less than this fraction of its value ends the search. */
const RELATIVE_TOLERANCE = 1e-6;

/** Projection weight of a box edge: small, so the projection moves boxes before it moves nodes. */
const BOX_WEIGHT = 1e-3;

export interface Solution {
  /** The coordinates reached; they satisfy every separation constraint. */
  x: number[];
  /** Gradient-projection iterations taken: the work count. */
  iterations: number;
  /** The objective at `x`. */
  objective: number;
}

/**
 * Minimises the placement objective over the separation constraints by Jacobi-scaled gradient projection (Dwyer,
 * Koren and Marriott, IPSep-CoLa, IEEE TVCG 12(5), 2006). Each iteration steps along the negative gradient scaled by
 * the Hessian's diagonal, projects the step onto the constraints in that scaled metric, and then takes the exact best
 * fraction of the projected move. The objective therefore never rises. The start is projected first. The search stops
 * after `cap` iterations, or when a step lowers the objective by less than 1e-6 of its value.
 */
export function solveQuadratic(
  problem: Problem,
  start: readonly number[],
  cap: number,
): Solution {
  const terms = termsOf(problem);
  const scale = jacobiScale(problem, terms);
  const x = [...start];
  project(problem, x, scale);
  let f = objective(terms, x);
  let iterations = 0;
  while (iterations < cap) {
    const g = gradient(terms, x);
    const s = g.map((gi, i) => gi / scale[i]!);
    const gs = dot(g, s);
    const qs = dot(s, hessianVector(terms, s));
    if (!(gs > 0 && qs > 0)) {
      break;
    }
    const trial = x.map((xi, i) => xi - (gs / qs) * s[i]!);
    project(problem, trial, scale);
    const d = trial.map((t, i) => t - x[i]!);
    const gd = dot(g, d);
    if (gd >= 0 || Number.isNaN(gd)) {
      break;
    }
    const qd = dot(d, hessianVector(terms, d));
    const beta = qd > 0 ? Math.min(1, -gd / qd) : 1;
    const decrease = -(beta * gd) - (beta * beta * qd) / 2;
    x.forEach((xi, i) => (x[i] = xi + beta * d[i]!));
    iterations++;
    const before = f;
    f -= decrease;
    if (decrease <= RELATIVE_TOLERANCE * before) {
      break;
    }
  }
  return { x, iterations, objective: objective(terms, x) };
}

/** The objective: the sum of the terms, in the order `termsOf` lists them. */
function objective(terms: readonly Term[], x: readonly number[]): number {
  let f = 0;
  for (const term of terms) {
    f += termValue(term, x);
  }
  return f;
}

/** The gradient of the objective at `x`. */
function gradient(terms: readonly Term[], x: readonly number[]): number[] {
  const g = Array.from({ length: x.length }, () => 0);
  for (const term of terms) {
    addGradient(term, x, g);
  }
  return g;
}

/** The Hessian times `v`: the sum of the terms' Hessians times `v`. The objective is quadratic, so this is exact. */
function hessianVector(terms: readonly Term[], v: readonly number[]): number[] {
  const out = Array.from({ length: v.length }, () => 0);
  for (const term of terms) {
    addHessian(term, v, out);
  }
  return out;
}

/**
 * The Hessian's diagonal, with 1 where a node has no term, so that scaling never divides by zero. A box edge has no
 * term of its own; it takes the small weight `BOX_WEIGHT`, so that the projection moves boxes rather than nodes.
 */
function jacobiScale(problem: Problem, terms: readonly Term[]): number[] {
  const nodes = problem.dummy.length;
  const diag = Array.from(
    { length: nodes + (problem.extra?.count ?? 0) },
    () => 0,
  );
  for (const term of terms) {
    addDiagonal(term, diag);
  }
  return diag.map((d, i) => (d > 0 ? d : i < nodes ? 1 : BOX_WEIGHT));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, ai, i) => sum + ai * b[i]!, 0);
}
