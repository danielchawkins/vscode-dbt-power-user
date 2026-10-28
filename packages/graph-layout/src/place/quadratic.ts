import type { Problem } from "./problem.js";
import { projectRanks } from "./projection.js";

/** A step that lowers the objective by less than this fraction of its value ends the search. */
const RELATIVE_TOLERANCE = 1e-6;

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
  const scale = jacobiScale(problem);
  const x = [...start];
  projectRanks(problem, x, scale);
  let f = objective(problem, x);
  let iterations = 0;
  while (iterations < cap) {
    const g = gradient(problem, x);
    const s = g.map((gi, i) => gi / scale[i]!);
    const gs = dot(g, s);
    const qs = dot(s, hessianVector(problem, s));
    if (!(gs > 0 && qs > 0)) {
      break;
    }
    const trial = x.map((xi, i) => xi - (gs / qs) * s[i]!);
    projectRanks(problem, trial, scale);
    const d = trial.map((t, i) => t - x[i]!);
    const gd = dot(g, d);
    if (gd >= 0 || Number.isNaN(gd)) {
      break;
    }
    const qd = dot(d, hessianVector(problem, d));
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
  return { x, iterations, objective: objective(problem, x) };
}

/** The objective: squared link lengths with their port offsets, plus squared pulls to each target. */
function objective(problem: Problem, x: readonly number[]): number {
  let f = 0;
  for (const link of problem.links) {
    const diff =
      x[link.top]! + link.topOffset - x[link.bottom]! - link.bottomOffset;
    f += link.weight * diff * diff;
  }
  for (const pull of problem.pulls) {
    const diff = x[pull.node]! - pull.target;
    f += pull.weight * diff * diff;
  }
  return f;
}

/** The gradient of the objective at `x`. */
function gradient(problem: Problem, x: readonly number[]): number[] {
  const g = Array.from({ length: x.length }, () => 0);
  for (const link of problem.links) {
    const diff =
      x[link.top]! + link.topOffset - x[link.bottom]! - link.bottomOffset;
    g[link.top]! += 2 * link.weight * diff;
    g[link.bottom]! -= 2 * link.weight * diff;
  }
  for (const pull of problem.pulls) {
    g[pull.node]! += 2 * pull.weight * (x[pull.node]! - pull.target);
  }
  return g;
}

/**
 * The Hessian times `v`. The objective is quadratic, so this is exact; the offsets do not enter it. Each link adds
 * 2w(v_top - v_bottom) to its ends with opposite signs, and each pull adds 2w to its node's own term.
 */
function hessianVector(problem: Problem, v: readonly number[]): number[] {
  const out = Array.from({ length: v.length }, () => 0);
  for (const link of problem.links) {
    const t = 2 * link.weight * (v[link.top]! - v[link.bottom]!);
    out[link.top]! += t;
    out[link.bottom]! -= t;
  }
  for (const pull of problem.pulls) {
    out[pull.node]! += 2 * pull.weight * v[pull.node]!;
  }
  return out;
}

/** The Hessian's diagonal, with 1 where a node has no term, so that scaling never divides by zero. */
function jacobiScale(problem: Problem): number[] {
  const diag = Array.from({ length: problem.dummy.length }, () => 0);
  for (const link of problem.links) {
    diag[link.top]! += 2 * link.weight;
    diag[link.bottom]! += 2 * link.weight;
  }
  for (const pull of problem.pulls) {
    diag[pull.node]! += 2 * pull.weight;
  }
  return diag.map((d) => (d > 0 ? d : 1));
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, ai, i) => sum + ai * b[i]!, 0);
}
