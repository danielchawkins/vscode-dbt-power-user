//! Sifting (Matuszewski, Schönfeld and Molitor, GD 1999): each unit of a rank in turn moves to the place in that rank
//! that gives the fewest crossings, the other units keeping their order. A unit moves only for a strict gain, so the
//! crossings never rise. A port of `order/sifting.ts`.

use super::clusters::legal_slots;
use super::crossings::group_crossings;
use super::model::{OrderModel, units_of};

/// A gain smaller than this is rounding, not a change of crossings.
const EPSILON: f64 = 1e-9;

/// Up to `rounds` sifting passes over the drawing, stopping early when a pass moves nothing. Only the units whose block
/// `movable` accepts move.
pub(crate) fn sift(model: &mut OrderModel<'_>, rounds: usize, movable: impl Fn(usize) -> bool) {
    for _ in 0..rounds {
        let mut moved = false;
        for rank in 0..model.layers.len() {
            moved = sift_rank(model, rank, &movable) || moved;
        }
        if !moved {
            return;
        }
    }
}

/// Sifts one rank. A pair's cost depends only on the neighbouring ranks, so the pair costs are computed once and the
/// rank is written back once at the end.
fn sift_rank(model: &mut OrderModel<'_>, rank: usize, movable: &impl Fn(usize) -> bool) -> bool {
    let graph = model.graph;
    let original = units_of(&model.layers[rank], &graph.block);
    let n = original.len();
    if n < 2 {
        return false;
    }
    // cost[i][j] is the crossing count when original[i] sits left of original[j].
    let cost: Vec<Vec<f64>> = (0..n)
        .map(|i| {
            (0..n)
                .map(|j| {
                    if i == j {
                        0.0
                    } else {
                        group_crossings(model, &original[i], &original[j])
                    }
                })
                .collect()
        })
        .collect();
    let chains: Vec<&[usize]> = original
        .iter()
        .map(|unit| graph.paths[unit[0]].as_slice())
        .collect();
    let mut order: Vec<usize> = (0..n).collect();
    for v in 0..n {
        if !movable(graph.block[original[v][0]]) {
            continue;
        }
        let others: Vec<usize> = order.iter().copied().filter(|&i| i != v).collect();
        let costs = sift_costs(&cost, v, &others);
        let here = order.iter().position(|&i| i == v).unwrap_or(0);
        let other_chains: Vec<&[usize]> = others.iter().map(|&i| chains[i]).collect();
        let legal = legal_slots(chains[v], &other_chains, here);
        let mut best = here;
        for (k, &c) in costs.iter().enumerate() {
            if legal[k] && c < costs[best] - EPSILON {
                best = k;
            }
        }
        if best != here {
            let mut next = others;
            next.insert(best, v);
            order = next;
        }
    }
    let moved = order.iter().enumerate().any(|(k, &i)| i != k);
    if moved {
        let layer: Vec<usize> = order
            .iter()
            .flat_map(|&i| original[i].iter().copied())
            .collect();
        model.set_layer(rank, layer);
    }
    moved
}

/// The crossings of placing unit `v` in each slot of `others` (the other units, in order): slot k puts `v` after the
/// first k of them. Moving `v` past a unit swaps the two orders of that pair.
fn sift_costs(cost: &[Vec<f64>], v: usize, others: &[usize]) -> Vec<f64> {
    let mut running = others.iter().fold(0.0, |sum, &u| sum + cost[v][u]);
    let mut costs = vec![running];
    for &u in others {
        running += cost[u][v] - cost[v][u];
        costs.push(running);
    }
    costs
}
