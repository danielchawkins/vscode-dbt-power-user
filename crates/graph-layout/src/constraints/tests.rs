//! Unit tests of the constraints module: equality reduction, cycle detection and the strongly connected components.

use super::{
    AxisProblem, Constraint, ConstraintError, components, cyclic_classes, reduce_equalities,
};

fn sep(from: usize, to: usize, gap: f64) -> Constraint {
    Constraint {
        from,
        to,
        gap,
        equality: false,
    }
}

fn eq(from: usize, to: usize, gap: f64) -> Constraint {
    Constraint {
        from,
        to,
        gap,
        equality: true,
    }
}

fn axis(desired: &[f64], constraints: Vec<Constraint>) -> AxisProblem {
    AxisProblem {
        desired: desired.to_vec(),
        weight: vec![1.0; desired.len()],
        constraints,
    }
}

#[test]
fn equalities_merge_classes_at_their_mean_and_keep_offsets() {
    // x1 = x0 + 10 exactly; the class is solved at the mean of (desired0) and (desired1 - 10).
    let problem = axis(&[0.0, 14.0, 5.0], vec![eq(0, 1, 10.0), sep(1, 2, 3.0)]);
    let reduction = reduce_equalities(&problem).expect("consistent equalities");
    assert_eq!(reduction.desired, vec![2.0, 5.0]);
    assert_eq!(reduction.weight, vec![2.0, 1.0]);
    assert_eq!(reduction.separations.len(), 1);
    assert_eq!(reduction.expand(&[7.0, 9.0]), vec![7.0, 17.0, 9.0]);
}

#[test]
fn a_class_of_one_variable_keeps_its_desired_position_exactly() {
    let problem = axis(&[0.1, 0.2], vec![eq(0, 0, 0.0), sep(0, 1, 0.0)]);
    let reduction = reduce_equalities(&problem).expect("self-equality is consistent");
    assert_eq!(reduction.desired, vec![0.1, 0.2]);
}

#[test]
fn without_equalities_the_problem_passes_through_unchanged() {
    let problem = axis(&[1.0, 2.0], vec![sep(0, 1, 4.0)]);
    let reduction = reduce_equalities(&problem).expect("no equalities");
    assert_eq!(reduction.desired, vec![1.0, 2.0]);
    let values = [-0.0, 3.0];
    let expanded = reduction.expand(&values);
    assert_eq!(expanded[0].to_bits(), (-0.0_f64).to_bits());
}

#[test]
fn contradictory_equalities_name_the_variable() {
    let problem = axis(
        &[0.0, 0.0, 0.0],
        vec![eq(0, 1, 1.0), eq(1, 2, 1.0), eq(0, 2, 3.0)],
    );
    match reduce_equalities(&problem) {
        Err(ConstraintError::Contradiction { variable, .. }) => assert_eq!(variable, 2),
        other => panic!("expected a contradiction, got {other:?}"),
    }
}

#[test]
fn an_out_of_range_index_is_refused() {
    let problem = axis(&[0.0], vec![sep(0, 3, 1.0)]);
    assert_eq!(
        reduce_equalities(&problem),
        Err(ConstraintError::IndexOutOfRange {
            index: 3,
            variables: 1
        })
    );
}

#[test]
fn merging_that_closes_a_cycle_is_reported_by_its_variables() {
    // 0 -> 1 separation, 1 = 2 equality, 2 -> 0 separation: merging {1, 2} closes a cycle with 0 outside it.
    let problem = axis(
        &[0.0, 0.0, 0.0, 9.0],
        vec![sep(0, 1, 1.0), eq(1, 2, 0.0), sep(2, 0, 1.0)],
    );
    match reduce_equalities(&problem) {
        Err(ConstraintError::Cycle { variables }) => assert_eq!(variables, vec![0, 1, 2]),
        other => panic!("expected a cycle, got {other:?}"),
    }
}

#[test]
fn cyclic_classes_is_empty_on_a_dag_and_names_a_cycle() {
    assert_eq!(
        cyclic_classes(3, &[sep(0, 1, 0.0), sep(1, 2, 0.0)]),
        Vec::<usize>::new()
    );
    // Node 2 is fed only by the cycle, so it lies between cycles and is reported with it.
    assert_eq!(
        cyclic_classes(3, &[sep(0, 1, 0.0), sep(1, 0, 0.0), sep(1, 2, 0.0)]),
        vec![0, 1, 2]
    );
}

#[test]
fn components_are_strongly_connected_groups() {
    let comp = components(4, &[(0, 1), (1, 0), (1, 2), (2, 3), (3, 2)]);
    assert_eq!(comp[0], comp[1]);
    assert_eq!(comp[2], comp[3]);
    assert_ne!(comp[0], comp[2]);
}
