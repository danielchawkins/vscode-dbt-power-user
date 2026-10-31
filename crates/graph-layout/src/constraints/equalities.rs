//! Equality reduction, a port of `constraints/equalities.ts`. Each class of variables held equal by equalities becomes one
//! variable, at the least-squares point of its members (the weighted mean of their desired positions less their
//! offsets). Each separation is rewritten between classes. Errors name the variable where equalities contradict, or where
//! merging closes a separation cycle.

use super::{AxisProblem, Constraint, ConstraintError, cyclic_classes};
use crate::solve::Separation;

/// Offsets that differ by no more than this are the same offset: a float sum, not a tolerance on the layout.
const TOLERANCE: f64 = 1e-9;

/// The problem over equality classes (one variable per class, numbered by the class's lowest member), and the map back.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Reduction {
    /// The class problem: its desired positions, weights and separations.
    pub(crate) desired: Vec<f64>,
    pub(crate) weight: Vec<f64>,
    pub(crate) separations: Vec<Separation>,
    /// Each original variable's class, and its offset from the class's root.
    class_of: Vec<usize>,
    offset: Vec<f64>,
    /// Set by `unchanged`: values pass through as they are, as TypeScript's `unchanged` copies them.
    identity: bool,
}

impl Reduction {
    /// The value of each original variable: its class's value plus its offset.
    pub(crate) fn expand(&self, values: &[f64]) -> Vec<f64> {
        if self.identity {
            return values.to_vec();
        }
        self.class_of
            .iter()
            .zip(&self.offset)
            .map(|(&c, &o)| values[c] + o)
            .collect()
    }
}

/// Reduces an axis problem so that its separations alone solve it. With no equalities the problem passes through, with
/// its equalities dropped, as TypeScript's `unchanged` does.
pub(crate) fn reduce_equalities(problem: &AxisProblem) -> Result<Reduction, ConstraintError> {
    check_indices(problem)?;
    if !problem.constraints.iter().any(|c| c.equality) {
        return Ok(unchanged(problem));
    }
    let (class_of, offset, count) = classes_of(problem)?;
    let separations: Vec<Constraint> = rewritten(problem, &class_of, &offset);
    let stuck = cyclic_classes(count, &separations);
    if !stuck.is_empty() {
        let variables = (0..problem.desired.len())
            .filter(|&v| stuck.contains(&class_of[v]))
            .collect();
        return Err(ConstraintError::Cycle { variables });
    }
    let weight = class_weights(problem, &class_of, count);
    Ok(Reduction {
        desired: class_means(problem, &class_of, &offset, &weight, count),
        weight,
        separations: to_separations(&separations),
        class_of,
        offset,
        identity: false,
    })
}

fn unchanged(problem: &AxisProblem) -> Reduction {
    let n = problem.desired.len();
    Reduction {
        desired: problem.desired.clone(),
        weight: problem.weight.clone(),
        separations: to_separations(
            &problem
                .constraints
                .iter()
                .filter(|c| !c.equality)
                .copied()
                .collect::<Vec<_>>(),
        ),
        class_of: (0..n).collect(),
        offset: vec![0.0; n],
        identity: true,
    }
}

fn to_separations(cs: &[Constraint]) -> Vec<Separation> {
    cs.iter()
        .map(|c| Separation {
            from: u32::try_from(c.from).unwrap_or(u32::MAX),
            to: u32::try_from(c.to).unwrap_or(u32::MAX),
            gap: c.gap,
        })
        .collect()
}

fn check_indices(problem: &AxisProblem) -> Result<(), ConstraintError> {
    let n = problem.desired.len();
    for c in &problem.constraints {
        for v in [c.from, c.to] {
            if v >= n {
                return Err(ConstraintError::IndexOutOfRange {
                    index: v,
                    variables: n,
                });
            }
        }
    }
    Ok(())
}

/// The class of each variable, numbered by its lowest member, its offset from that member, and the class count.
fn classes_of(problem: &AxisProblem) -> Result<(Vec<usize>, Vec<f64>, usize), ConstraintError> {
    let n = problem.desired.len();
    let links = equality_links(problem);
    let mut root: Vec<Option<usize>> = vec![None; n];
    let mut offset = vec![0.0_f64; n];
    for v in 0..n {
        if root[v].is_none() {
            spread(&links, v, &mut root, &mut offset)?;
        }
    }
    let mut number = vec![usize::MAX; n];
    let mut count = 0;
    for v in 0..n {
        if root[v] == Some(v) {
            number[v] = count;
            count += 1;
        }
    }
    let class_of = (0..n).map(|v| number[root[v].unwrap_or(v)]).collect();
    Ok((class_of, offset, count))
}

/// Each variable's equality links: the other end, and the offset it sits from this end.
fn equality_links(problem: &AxisProblem) -> Vec<Vec<(usize, f64)>> {
    let mut links: Vec<Vec<(usize, f64)>> = vec![Vec::new(); problem.desired.len()];
    for c in problem.constraints.iter().filter(|c| c.equality) {
        links[c.from].push((c.to, c.gap));
        links[c.to].push((c.from, -c.gap));
    }
    links
}

/// Breadth-first over one class from `start`, recording each member's root and offset. A member reached again by a
/// different offset is a contradiction, reported by the variable where it closes.
fn spread(
    links: &[Vec<(usize, f64)>],
    start: usize,
    root: &mut [Option<usize>],
    offset: &mut [f64],
) -> Result<(), ConstraintError> {
    root[start] = Some(start);
    let mut queue = vec![start];
    let mut next = 0;
    while next < queue.len() {
        let u = queue[next];
        next += 1;
        for &(to, step) in &links[u] {
            let want = offset[u] + step;
            match root[to] {
                None => {
                    root[to] = Some(start);
                    offset[to] = want;
                    queue.push(to);
                }
                Some(_) if (offset[to] - want).abs() > TOLERANCE => {
                    return Err(ConstraintError::Contradiction {
                        variable: to,
                        forced: want,
                        found: offset[to],
                    });
                }
                Some(_) => {}
            }
        }
    }
    Ok(())
}

/// The separations rewritten between classes: each end becomes its class, and the gap absorbs both offsets.
fn rewritten(problem: &AxisProblem, class_of: &[usize], offset: &[f64]) -> Vec<Constraint> {
    problem
        .constraints
        .iter()
        .filter(|c| !c.equality)
        .map(|c| Constraint {
            from: class_of[c.from],
            to: class_of[c.to],
            gap: c.gap + offset[c.from] - offset[c.to],
            equality: false,
        })
        .collect()
}

/// Each class's least-squares desired position; a class of one variable keeps that variable's position exactly.
fn class_means(
    problem: &AxisProblem,
    class_of: &[usize],
    offset: &[f64],
    weight: &[f64],
    count: usize,
) -> Vec<f64> {
    let mut sum = vec![0.0_f64; count];
    let mut size = vec![0_usize; count];
    let mut only = vec![0_usize; count];
    for (v, &d) in problem.desired.iter().enumerate() {
        let c = class_of[v];
        sum[c] += problem.weight[v] * (d - offset[v]);
        size[c] += 1;
        only[c] = v;
    }
    (0..count)
        .map(|c| {
            if size[c] == 1 {
                problem.desired[only[c]]
            } else {
                sum[c] / weight[c]
            }
        })
        .collect()
}

fn class_weights(problem: &AxisProblem, class_of: &[usize], count: usize) -> Vec<f64> {
    let mut weight = vec![0.0_f64; count];
    for (v, &w) in problem.weight.iter().enumerate() {
        weight[class_of[v]] += w;
    }
    weight
}
