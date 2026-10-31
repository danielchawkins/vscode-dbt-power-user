//! Projection onto the separations, a port of `packages/graph-layout/src/place/projection.ts`. Without cluster boxes the
//! separations are the rank chains, and each rank is projected exactly by pool-adjacent-violators (`project_ranks`);
//! with boxes every separation is one axis problem for the solver (`solve`).

use super::problem::Problem;
use crate::solve::{Problem as SolveProblem, Projector, SolveError};

/// Floor on a node's projection weight, so a block's weighted mean is always defined.
const MIN_WEIGHT: f64 = 1e-12;

/// Adjacent nodes of one rank pooled into a block: their weighted mean of shifted coordinates, and their weight.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Block {
    value: f64,
    weight: f64,
    size: usize,
}

/// Projects `x` onto the problem's separations in the metric of `weight`. Without cluster boxes these are the rank chains,
/// and the per-rank projection is exact; with boxes, every separation, boxes included, is solved as one axis problem.
pub(crate) fn project(
    problem: &Problem,
    projector: &mut Projector,
    x: &mut [f64],
    weight: &[f64],
) -> Result<(), SolveError> {
    let Some(extra) = &problem.extra else {
        project_ranks(problem, x, weight);
        return Ok(());
    };
    let solved = projector.solve(&SolveProblem {
        x0: &*x,
        weight,
        separations: &extra.separations,
    })?;
    x.copy_from_slice(solved);
    Ok(())
}

/// Projects the coordinates of each rank onto its gaps, in the metric of `weight`: the nearest point, by weighted squared
/// distance, at which every node sits at least `gap_left` beyond its left neighbour. Subtracting the running sum of the
/// gaps turns the constraints into a monotone fit, which weighted pool-adjacent-violators solves exactly. `x` is changed
/// in place. Only differences of gaps matter, so the gap of a rank's leftmost node is irrelevant.
pub(crate) fn project_ranks(problem: &Problem, x: &mut [f64], weight: &[f64]) {
    for layer in &problem.layers {
        let mut offsets = Vec::with_capacity(layer.len());
        let mut total = 0.0;
        for &v in layer {
            total += problem.gap_left[v];
            offsets.push(total);
        }
        let mut blocks: Vec<Block> = Vec::with_capacity(layer.len());
        for (k, &v) in layer.iter().enumerate() {
            let mut block = Block {
                value: x[v] - offsets[k],
                weight: weight[v].max(MIN_WEIGHT),
                size: 1,
            };
            while let Some(prev) = blocks
                .last()
                .copied()
                .filter(|prev| prev.value > block.value)
            {
                blocks.pop();
                let sum = prev.weight + block.weight;
                block = Block {
                    value: (prev.value * prev.weight + block.value * block.weight) / sum,
                    weight: sum,
                    size: prev.size + block.size,
                };
            }
            blocks.push(block);
        }
        let mut k = 0;
        for block in &blocks {
            for _ in 0..block.size {
                x[layer[k]] = block.value + offsets[k];
                k += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(gaps: &[f64]) -> Problem {
        Problem {
            layers: vec![(0..gaps.len()).collect()],
            gap_left: gaps.to_vec(),
            dummy: vec![false; gaps.len()],
            links: Vec::new(),
            pulls: Vec::new(),
            extra: None,
        }
    }

    #[test]
    fn a_feasible_rank_is_unchanged() {
        let problem = chain(&[0.0, 2.0, 2.0]);
        let mut x = vec![0.0, 2.0, 4.0];
        project_ranks(&problem, &mut x, &[1.0, 1.0, 1.0]);
        assert_eq!(x, vec![0.0, 2.0, 4.0]);
    }

    #[test]
    fn a_violated_pair_is_pooled_at_its_weighted_mean() {
        // Node 1 must sit 2 beyond node 0. Both want 0, node 1 with weight 3 and node 0 with weight 1. The shifted values
        // are 0 and -2, pooled at (0*1 + -2*3) / 4 = -1.5; node 0 takes -1.5 and node 1 takes -1.5 + 2 = 0.5.
        let problem = chain(&[0.0, 2.0]);
        let mut x = vec![0.0, 0.0];
        project_ranks(&problem, &mut x, &[1.0, 3.0]);
        assert!((x[0] + 1.5).abs() < 1e-12);
        assert!((x[1] - 0.5).abs() < 1e-12);
    }
}
