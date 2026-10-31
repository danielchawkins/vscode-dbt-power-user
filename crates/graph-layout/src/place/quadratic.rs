//! The placement search: Jacobi-scaled gradient projection over the separations (Dwyer, Koren and Marriott, IPSep-CoLa, IEEE
//! TVCG 12(5), 2006), a port of `packages/graph-layout/src/place/quadratic.ts`. Each iteration steps along the negative
//! gradient scaled by the Hessian's diagonal, projects the step onto the separations in that metric, and takes the exact
//! best fraction of the projected move. The objective never rises.

use super::problem::Problem;
use super::projection::project;
use super::terms::{diagonal, gradient, hessian_vector, objective};
use crate::solve::{Projector, SolveError};

/// A step that lowers the objective by less than this fraction of its value ends the search.
const RELATIVE_TOLERANCE: f64 = 1e-6;

/// Projection weight of a box edge: small, so the projection moves boxes before it moves nodes.
const BOX_WEIGHT: f64 = 1e-3;

/// The coordinates reached, the iterations taken, and the objective at them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Solution {
    /// The coordinates reached; they satisfy every separation.
    pub(crate) x: Vec<f64>,
    /// Gradient-projection iterations taken: the work count.
    pub(crate) iterations: usize,
    /// The objective at `x`.
    pub(crate) objective: f64,
}

/// Minimises the placement objective over the separations from `start`, which is projected first. The search stops after
/// `cap` iterations, or when a step lowers the objective by less than `RELATIVE_TOLERANCE` of its value.
pub(crate) fn solve_quadratic(
    problem: &Problem,
    start: &[f64],
    cap: usize,
) -> Result<Solution, SolveError> {
    let mut projector = Projector::new();
    let scale = jacobi_scale(problem);
    let mut point = start.to_vec();
    project(problem, &mut projector, &mut point, &scale)?;
    let mut f = objective(problem, &point);
    let mut iterations = 0;
    while iterations < cap {
        let grad = gradient(problem, &point);
        let scaled: Vec<f64> = grad.iter().zip(&scale).map(|(gi, si)| gi / si).collect();
        let gs = dot(&grad, &scaled);
        let qs = dot(&scaled, &hessian_vector(problem, &scaled));
        if !(gs > 0.0 && qs > 0.0) {
            break;
        }
        let mut trial: Vec<f64> = point
            .iter()
            .zip(&scaled)
            .map(|(xi, si)| xi - (gs / qs) * si)
            .collect();
        project(problem, &mut projector, &mut trial, &scale)?;
        let delta: Vec<f64> = trial
            .iter()
            .zip(&point)
            .map(|(moved, xi)| moved - xi)
            .collect();
        let gd = dot(&grad, &delta);
        if gd >= 0.0 || gd.is_nan() {
            break;
        }
        let qd = dot(&delta, &hessian_vector(problem, &delta));
        let beta = if qd > 0.0 { (-gd / qd).min(1.0) } else { 1.0 };
        let decrease = -(beta * gd) - (beta * beta * qd) / 2.0;
        for (xi, di) in point.iter_mut().zip(&delta) {
            *xi += beta * di;
        }
        iterations += 1;
        let before = f;
        f -= decrease;
        if decrease <= RELATIVE_TOLERANCE * before {
            break;
        }
    }
    Ok(Solution {
        objective: objective(problem, &point),
        x: point,
        iterations,
    })
}

/// The Hessian's diagonal, with 1 where a node has no term, so that scaling never divides by zero. A box edge has no
/// term of its own; it takes the small weight `BOX_WEIGHT`, so that the projection moves boxes rather than nodes.
fn jacobi_scale(problem: &Problem) -> Vec<f64> {
    let nodes = problem.dummy.len();
    diagonal(problem, problem.variables())
        .into_iter()
        .enumerate()
        .map(|(i, d)| {
            if d > 0.0 {
                d
            } else if i < nodes {
                1.0
            } else {
                BOX_WEIGHT
            }
        })
        .collect()
}

/// The dot product, summed in index order.
fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).fold(0.0, |sum, (ai, bi)| sum + ai * bi)
}

#[cfg(test)]
mod tests {
    use super::super::problem::{Extension, Link, Pull};
    use super::super::projection::project_ranks;
    use super::*;
    use crate::solve::Separation;

    fn chain_of_ranks(count: usize, gap: f64) -> Problem {
        Problem {
            layers: (0..count).map(|r| vec![r]).collect(),
            gap_left: vec![gap; count],
            dummy: vec![false; count],
            links: Vec::new(),
            pulls: Vec::new(),
            extra: None,
        }
    }

    #[test]
    fn a_single_link_between_two_ranks_pulls_its_ends_together() {
        let problem = Problem {
            links: vec![Link::new(0, 1)],
            ..chain_of_ranks(2, 0.0)
        };
        let solved = solve_quadratic(&problem, &[0.0, 10.0], 100).expect("solves");
        assert!((solved.x[0] - solved.x[1]).abs() < 1e-6, "{:?}", solved.x);
        assert!(solved.objective < 1e-9);
    }

    #[test]
    fn the_objective_never_rises_and_every_gap_holds() {
        // One rank of three nodes, each 2 beyond its left neighbour, with node 2 pulled back to the origin.
        let problem = Problem {
            layers: vec![vec![0, 1, 2]],
            gap_left: vec![0.0, 2.0, 2.0],
            dummy: vec![false; 3],
            links: vec![Link::new(0, 1), Link::new(1, 2)],
            pulls: vec![Pull {
                node: 2,
                weight: 3.0,
                target: 0.0,
            }],
            extra: None,
        };
        let start = [0.0, 2.0, 4.0];
        let mut projected = start.to_vec();
        project_ranks(&problem, &mut projected, &[1.0; 3]);
        let before = objective(&problem, &projected);
        let solved = solve_quadratic(&problem, &start, 50).expect("solves");
        assert!(
            solved.objective <= before + 1e-12,
            "{} > {before}",
            solved.objective
        );
        assert!(solved.x[1] - solved.x[0] >= 2.0 - 1e-9);
        assert!(solved.x[2] - solved.x[1] >= 2.0 - 1e-9);
    }

    #[test]
    fn a_box_separation_is_held_by_the_solver() {
        // Nodes 0 and 1 want 0; variable 2 is a box edge that must sit 5 beyond node 0.
        let problem = Problem {
            pulls: vec![
                Pull {
                    node: 0,
                    weight: 1.0,
                    target: 0.0,
                },
                Pull {
                    node: 1,
                    weight: 1.0,
                    target: 0.0,
                },
            ],
            extra: Some(Extension {
                count: 1,
                separations: vec![Separation {
                    from: 0,
                    to: 2,
                    gap: 5.0,
                }],
            }),
            ..chain_of_ranks(2, 0.0)
        };
        let solved = solve_quadratic(&problem, &[0.0, 0.0, 0.0], 50).expect("solves");
        assert_eq!(solved.x.len(), 3);
        assert!(solved.x[2] - solved.x[0] >= 5.0 - 1e-9, "{:?}", solved.x);
    }
}
