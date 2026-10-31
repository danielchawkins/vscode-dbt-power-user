//! The fewest weighted crossings that any in-rank order of a layered graph reaches, by exhaustive search: the oracle of
//! `testing/exactCrossings.ts`, which the ordering is checked against. Each rank's units are permuted; the ranks, the
//! dummy chains and each unit's inside stay as they are. Test-only: the search is exponential.

use std::collections::BTreeSet;

use super::crossings::total_crossings;
use super::model::{OrderModel, units_of};
use crate::layering::LayeredGraph;

/// Orders tried before the search gives up. A fixture larger than this is not a gold-standard candidate.
const MAX_ORDERS: usize = 5_000_000;

/// The exact minimum and one order that reaches it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Exact {
    pub(crate) crossings: f64,
    pub(crate) layers: Vec<Vec<usize>>,
}

/// The exact minimum over every in-rank order of `layers` that keeps each cluster contiguous, counted as the ordering
/// counts it. `None` when the number of orders exceeds `MAX_ORDERS` (TypeScript throws there).
pub(crate) fn exact_minimum_crossings(
    graph: &LayeredGraph,
    layers: &[Vec<usize>],
) -> Option<Exact> {
    let units_by_rank: Vec<Vec<Vec<usize>>> = layers
        .iter()
        .map(|layer| units_of(layer, &graph.block))
        .collect();
    let total = units_by_rank.iter().fold(1_usize, |product, units| {
        product.saturating_mul(factorial(units.len()))
    });
    if total > MAX_ORDERS {
        return None;
    }
    let mut model = OrderModel::new(graph, layers.to_vec());
    let mut best = Exact {
        crossings: f64::INFINITY,
        layers: layers.to_vec(),
    };
    visit(&mut model, &units_by_rank, 0, &mut best);
    Some(best)
}

fn visit(
    model: &mut OrderModel<'_>,
    units_by_rank: &[Vec<Vec<usize>>],
    rank: usize,
    best: &mut Exact,
) {
    if rank == units_by_rank.len() {
        let crossings = total_crossings(model);
        if crossings < best.crossings {
            *best = Exact {
                crossings,
                layers: model.layers.clone(),
            };
        }
        return;
    }
    let graph = model.graph;
    let mut units = units_by_rank[rank].clone();
    let count = units.len();
    heap(count, &mut units, &mut |permutation: &[Vec<usize>]| {
        if !contiguous(permutation, &graph.paths) {
            return;
        }
        model.set_layer(rank, permutation.concat());
        visit(model, units_by_rank, rank + 1, best);
    });
}

/// Whether every cluster's units are one unbroken run in `units`.
fn contiguous(units: &[Vec<usize>], paths: &[Vec<usize>]) -> bool {
    let mut closed = BTreeSet::new();
    let mut open: &[usize] = &[];
    for unit in units {
        let chain = paths[unit[0]].as_slice();
        for c in open {
            if !chain.contains(c) {
                closed.insert(*c);
            }
        }
        if chain.iter().any(|c| closed.contains(c)) {
            return false;
        }
        open = chain;
    }
    true
}

/// Calls `visit` once for every permutation of `items[..k]`, by Heap's algorithm (a permutation of the whole slice when
/// `k` is its length). Each permutation is a rearrangement of `items`, left in some order when the walk ends.
fn heap(k: usize, items: &mut [Vec<usize>], visit: &mut impl FnMut(&[Vec<usize>])) {
    if k <= 1 {
        visit(items);
        return;
    }
    heap(k - 1, items, visit);
    for i in 0..k - 1 {
        if k.is_multiple_of(2) {
            items.swap(i, k - 1);
        } else {
            items.swap(0, k - 1);
        }
        heap(k - 1, items, visit);
    }
}

fn factorial(n: usize) -> usize {
    (2..=n).fold(1_usize, usize::saturating_mul)
}
