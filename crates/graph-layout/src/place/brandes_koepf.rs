//! Brandes and Köpf's linear-time horizontal coordinate assignment (GD 2001), a port of
//! `packages/graph-layout/src/place/brandesKoepf.ts`. Four alignments (down or up, left or right) are compacted; each is
//! moved to the width of the narrowest, and every node takes the mean of the two middle positions of its four. Port
//! offsets are not part of the alignment. The compaction can leave a gap short, so the balanced result is projected back
//! onto the gaps, which keeps the order.

use super::alignment::{Adjacency, Pass, adjacency, align_blocks, frame_of, type_one_conflicts};
use super::compaction::compact;
use super::problem::Problem;
use super::projection::project_ranks;
use std::cmp::Ordering;

/// One horizontal pass: its coordinates in the drawing's orientation, and whether it ran mirrored.
struct Run {
    x: Vec<f64>,
    mirror: bool,
}

/// The coordinate of each node: the Brandes and Köpf start, projected onto the rank gaps. Coordinates are centres along
/// the in-rank axis.
pub(crate) fn brandes_koepf(problem: &Problem) -> Vec<f64> {
    let n = problem.dummy.len();
    let conflict = type_one_conflicts(problem);
    let Adjacency { above, below } = adjacency(problem);
    let mut runs = Vec::with_capacity(4);
    for from_above in [true, false] {
        for mirror in [false, true] {
            let frame = frame_of(problem, mirror);
            let pass = Pass {
                adjacent: if from_above { &above } else { &below },
                conflict: &conflict,
                from_above,
            };
            let blocks = align_blocks(&frame, &pass);
            let mut x = compact(&frame, &blocks);
            if mirror {
                for value in &mut x {
                    *value = -*value;
                }
            }
            runs.push(Run { x, mirror });
        }
    }
    let mut x = balance(&runs, n);
    let ones = vec![1.0; n];
    project_ranks(problem, &mut x, &ones);
    x
}

/// The lowest and highest coordinate of a pass.
fn extent(x: &[f64]) -> (f64, f64) {
    x.iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &v| {
            (lo.min(v), hi.max(v))
        })
}

/// Moves each run to the width of the narrowest, then takes each node's mean of its two middle coordinates.
fn balance(runs: &[Run], n: usize) -> Vec<f64> {
    let width = |run: &Run| {
        let (lo, hi) = extent(&run.x);
        hi - lo
    };
    let mut narrow = &runs[0];
    for run in &runs[1..] {
        if width(run) < width(narrow) {
            narrow = run;
        }
    }
    let (target_lo, target_hi) = extent(&narrow.x);
    let aligned: Vec<Vec<f64>> = runs
        .iter()
        .map(|run| {
            let (lo, hi) = extent(&run.x);
            let by = if run.mirror {
                target_hi - hi
            } else {
                target_lo - lo
            };
            run.x.iter().map(|value| value + by).collect()
        })
        .collect();
    (0..n)
        .map(|v| {
            let mut values: Vec<f64> = aligned.iter().map(|x| x[v]).collect();
            values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
            f64::midpoint(values[1], values[2])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::problem::Link;
    use super::*;

    fn span(from: usize, to: usize) -> Vec<usize> {
        (from..to).collect()
    }

    /// Every rank's neighbours sit at least their gap apart.
    fn assert_separated(problem: &Problem, x: &[f64]) {
        for layer in &problem.layers {
            for pair in layer.windows(2) {
                let (a, b) = (pair[0], pair[1]);
                assert!(
                    x[b] - x[a] >= problem.gap_left[b] - 1e-9,
                    "nodes {a} and {b} are closer than their gap"
                );
            }
        }
    }

    #[test]
    fn keeps_every_gap_in_the_class_shift_counterexample() {
        let problem = Problem {
            layers: vec![
                span(0, 7),
                span(7, 14),
                vec![14, 15],
                span(16, 21),
                span(21, 25),
            ],
            gap_left: vec![1.0; 25],
            dummy: vec![false; 25],
            links: vec![Link::new(16, 21), Link::new(14, 17)],
            pulls: Vec::new(),
            extra: None,
        };
        let x = brandes_koepf(&problem);
        assert_separated(&problem, &x);
    }

    #[test]
    fn keeps_a_chain_of_dummies_on_one_straight_line() {
        // a -> d1 -> d2 -> b, with a second chain beside it on the same ranks.
        let problem = Problem {
            layers: vec![vec![0, 4], vec![1, 5], vec![2, 6], vec![3, 7]],
            gap_left: vec![0.0, 0.0, 0.0, 0.0, 10.0, 10.0, 10.0, 10.0],
            dummy: vec![false, true, true, false, false, true, true, false],
            links: vec![
                Link::new(0, 1),
                Link::new(1, 2),
                Link::new(2, 3),
                Link::new(4, 5),
                Link::new(5, 6),
                Link::new(6, 7),
            ],
            pulls: Vec::new(),
            extra: None,
        };
        let x = brandes_koepf(&problem);
        for (a, b) in [(0, 1), (1, 2), (2, 3), (4, 5), (5, 6), (6, 7)] {
            assert!((x[a] - x[b]).abs() < 1e-9, "{a} and {b} are not straight");
        }
        assert!(x[4] - x[0] >= 10.0 - 1e-9);
    }

    #[test]
    fn a_single_node_rank_is_placed_at_its_own_mean() {
        let problem = Problem {
            layers: vec![vec![0]],
            gap_left: vec![0.0],
            dummy: vec![false],
            links: Vec::new(),
            pulls: Vec::new(),
            extra: None,
        };
        assert_eq!(brandes_koepf(&problem), vec![0.0]);
    }
}
