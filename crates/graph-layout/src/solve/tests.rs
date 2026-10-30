//! Unit tests of the solver: the rejections of its input, and small problems whose optimum is known by hand. The MSAGL
//! cases, the exact-oracle property tests and the TypeScript parity are in the sibling modules.

use super::{Problem, Separation, SolveError, solve};

fn sep(from: u32, to: u32, gap: f64) -> Separation {
    Separation { from, to, gap }
}

fn problem<'a>(x0: &'a [f64], weight: &'a [f64], separations: &'a [Separation]) -> Problem<'a> {
    Problem {
        x0,
        weight,
        separations,
    }
}

#[test]
fn two_variables_are_pushed_apart_symmetrically() {
    let separations = [sep(0, 1, 2.0)];
    let x = solve(&problem(&[0.0, 0.0], &[1.0, 1.0], &separations)).expect("feasible");
    assert_eq!(x, vec![-1.0, 1.0]);
}

#[test]
fn a_satisfied_separation_leaves_the_targets_alone() {
    let separations = [sep(0, 1, 1.0)];
    let x = solve(&problem(&[0.0, 5.0], &[1.0, 1.0], &separations)).expect("feasible");
    assert_eq!(x, vec![0.0, 5.0]);
}

#[test]
fn a_directed_cycle_is_rejected_and_named() {
    let separations = [sep(0, 1, 2.0), sep(1, 0, 3.0)];
    let err = solve(&problem(&[1.0, 2.0], &[1.0, 1.0], &separations)).expect_err("cycle");
    let message = err.to_string();
    assert!(
        message == "separations contain a directed cycle: 0 -> 1 -> 0"
            || message == "separations contain a directed cycle: 1 -> 0 -> 1",
        "{message}"
    );
}

#[test]
fn an_indirect_cycle_is_rejected_and_named() {
    let separations = [sep(0, 1, 4.0), sep(1, 2, 4.0), sep(2, 1, 4.0)];
    let err = solve(&problem(&[1.0, 2.0, 3.0], &[1.0; 3], &separations)).expect_err("cycle");
    let message = err.to_string();
    assert!(
        message == "separations contain a directed cycle: 1 -> 2 -> 1"
            || message == "separations contain a directed cycle: 2 -> 1 -> 2",
        "{message}"
    );
}

#[test]
fn a_self_separation_with_a_positive_gap_is_rejected() {
    let separations = [sep(0, 0, 1.0)];
    let err = solve(&problem(&[0.0], &[1.0], &separations)).expect_err("self");
    assert_eq!(
        err,
        SolveError::SelfSeparation {
            variable: 0,
            gap: 1.0
        }
    );
}

#[test]
fn a_self_separation_that_cannot_be_positive_is_dropped() {
    let separations = [sep(0, 0, 0.0), sep(0, 0, -3.0)];
    let x = solve(&problem(&[2.5], &[1.0], &separations)).expect("holds");
    assert_eq!(x, vec![2.5]);
}

#[test]
fn bad_weights_and_indices_are_rejected() {
    assert_eq!(
        solve(&problem(&[0.0, 0.0], &[1.0], &[])),
        Err(SolveError::LengthMismatch {
            variables: 2,
            weights: 1
        })
    );
    assert_eq!(
        solve(&problem(&[0.0], &[0.0], &[])),
        Err(SolveError::NonPositiveWeight)
    );
    assert_eq!(
        solve(&problem(&[0.0], &[f64::NAN], &[])),
        Err(SolveError::NonPositiveWeight)
    );
    assert_eq!(
        solve(&problem(&[0.0], &[1.0], &[sep(0, 1, 1.0)])),
        Err(SolveError::IndexOutOfRange {
            index: 1,
            variables: 1
        })
    );
}
