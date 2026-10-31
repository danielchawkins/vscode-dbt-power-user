//! The terms of the placement objective, a port of `packages/graph-layout/src/place/terms.ts`. The objective is the sum of
//! the link terms, `w (x_top + top_offset - x_bottom - bottom_offset)^2`, and the pull terms, `w (x_node - target)^2`.
//! Every sum runs links first, then pulls, as in TypeScript, so the floating-point operations are the same.

use super::problem::Problem;

/// The objective at `x`.
pub(crate) fn objective(problem: &Problem, x: &[f64]) -> f64 {
    let mut f = 0.0;
    for link in &problem.links {
        let diff = x[link.top] + link.top_offset - x[link.bottom] - link.bottom_offset;
        f += link.weight * diff * diff;
    }
    for pull in &problem.pulls {
        let diff = x[pull.node] - pull.target;
        f += pull.weight * diff * diff;
    }
    f
}

/// The gradient of the objective at `x`, one entry per variable.
pub(crate) fn gradient(problem: &Problem, x: &[f64]) -> Vec<f64> {
    let mut g = vec![0.0; x.len()];
    for link in &problem.links {
        let diff = x[link.top] + link.top_offset - x[link.bottom] - link.bottom_offset;
        g[link.top] += 2.0 * link.weight * diff;
        g[link.bottom] -= 2.0 * link.weight * diff;
    }
    for pull in &problem.pulls {
        g[pull.node] += 2.0 * pull.weight * (x[pull.node] - pull.target);
    }
    g
}

/// The Hessian times `v`. The objective is quadratic, so this is exact; the offsets do not enter it.
pub(crate) fn hessian_vector(problem: &Problem, v: &[f64]) -> Vec<f64> {
    let mut out = vec![0.0; v.len()];
    for link in &problem.links {
        let t = 2.0 * link.weight * (v[link.top] - v[link.bottom]);
        out[link.top] += t;
        out[link.bottom] -= t;
    }
    for pull in &problem.pulls {
        out[pull.node] += 2.0 * pull.weight * v[pull.node];
    }
    out
}

/// The Hessian's diagonal over `variables` variables. A variable with no term has zero here.
pub(crate) fn diagonal(problem: &Problem, variables: usize) -> Vec<f64> {
    let mut diag = vec![0.0; variables];
    for link in &problem.links {
        diag[link.top] += 2.0 * link.weight;
        diag[link.bottom] += 2.0 * link.weight;
    }
    for pull in &problem.pulls {
        diag[pull.node] += 2.0 * pull.weight;
    }
    diag
}
