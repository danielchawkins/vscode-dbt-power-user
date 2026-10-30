import type { Link, Problem, Pull } from "./problem.js";

/**
 * One term of the placement objective: a weighted square of a difference of coordinates. The objective is the sum of
 * its terms, taken in the order `termsOf` lists them, and the value, gradient, Hessian and diagonal of the solver are
 * each a sum over that same list. Today a term is a link between two adjacent ranks or a pull of one node to a target
 * (an anchor, or a hint). An attraction, a weighted pull between two nodes, is a third kind: it adds a variant here,
 * and each function below takes a case for it. The phases that build the problem are not touched.
 */
export type Term =
  | { readonly kind: "link"; readonly link: Link }
  | { readonly kind: "pull"; readonly pull: Pull };

/** The terms of `problem`: its links, then its pulls. Each sum over the terms runs in this order. */
export function termsOf(problem: Problem): Term[] {
  return [
    ...problem.links.map((link): Term => ({ kind: "link", link })),
    ...problem.pulls.map((pull): Term => ({ kind: "pull", pull })),
  ];
}

/** The value of a term at `x`. */
export function termValue(term: Term, x: readonly number[]): number {
  switch (term.kind) {
    case "link": {
      const { link } = term;
      const diff =
        x[link.top]! + link.topOffset - x[link.bottom]! - link.bottomOffset;
      return link.weight * diff * diff;
    }
    case "pull": {
      const { pull } = term;
      const diff = x[pull.node]! - pull.target;
      return pull.weight * diff * diff;
    }
  }
}

/** Adds the gradient of a term at `x` to `g`. */
export function addGradient(
  term: Term,
  x: readonly number[],
  g: number[],
): void {
  switch (term.kind) {
    case "link": {
      const { link } = term;
      const diff =
        x[link.top]! + link.topOffset - x[link.bottom]! - link.bottomOffset;
      g[link.top]! += 2 * link.weight * diff;
      g[link.bottom]! -= 2 * link.weight * diff;
      return;
    }
    case "pull": {
      const { pull } = term;
      g[pull.node]! += 2 * pull.weight * (x[pull.node]! - pull.target);
      return;
    }
  }
}

/**
 * Adds the term's Hessian times `v` to `out`. A term is quadratic, so this is exact, and the offsets do not enter it. A
 * link adds 2w(v_top - v_bottom) to its ends with opposite signs; a pull adds 2w to its node's own term.
 */
export function addHessian(
  term: Term,
  v: readonly number[],
  out: number[],
): void {
  switch (term.kind) {
    case "link": {
      const { link } = term;
      const t = 2 * link.weight * (v[link.top]! - v[link.bottom]!);
      out[link.top]! += t;
      out[link.bottom]! -= t;
      return;
    }
    case "pull": {
      const { pull } = term;
      out[pull.node]! += 2 * pull.weight * v[pull.node]!;
      return;
    }
  }
}

/** Adds the term's contribution to the Hessian's diagonal in `diag`. */
export function addDiagonal(term: Term, diag: number[]): void {
  switch (term.kind) {
    case "link": {
      const { link } = term;
      diag[link.top]! += 2 * link.weight;
      diag[link.bottom]! += 2 * link.weight;
      return;
    }
    case "pull": {
      const { pull } = term;
      diag[pull.node]! += 2 * pull.weight;
      return;
    }
  }
}
