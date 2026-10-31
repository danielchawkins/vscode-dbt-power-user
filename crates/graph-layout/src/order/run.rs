//! The ordering of a layered graph: the starting order, the searches from it and from shuffled restarts, the hinted
//! candidates, and the result with its crossings. A port of `order/index.ts` for graphs without opaque clusters, whose
//! `keepOutside` pass returns its input unchanged (see `order/mod.rs`).

use super::clusters::gather_clusters;
use super::model::{OrderModel, units_of};
use super::seed::{Hints, starting_layers};
use super::sifting::sift;
use super::sweeps::{Found, found, search};
use crate::budget::Budget;
use crate::layering::LayeredGraph;
use crate::rand::Mulberry32;

/// The ordered layers and their weighted crossings.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Ordered {
    pub(crate) layers: Vec<Vec<usize>>,
    pub(crate) crossings: f64,
}

/// Orders the nodes and dummies of each rank to reduce weighted crossings. The search starts from the hinted or
/// depth-first order and keeps the order with the fewest crossings seen; a restart replaces it only with strictly fewer.
/// With hints, the unhinted search runs as well, and the hinted order with its dummies sifted is kept when it is no
/// worse. The result is a pure function of the graph, the hints, the budget and the seed.
pub(crate) fn order(
    layered: &LayeredGraph,
    hints: Option<&Hints>,
    budget: &Budget,
    seed: u32,
) -> Ordered {
    assert!(
        layered.nodes.iter().all(|node| node.port.is_none()),
        "order: lateral port dummies are not ported yet"
    );
    let start = starting_layers(layered, hints);
    let mut best = search_from(layered, &start, budget, seed);
    if hints.is_some() {
        let fresh = search_from(layered, &starting_layers(layered, None), budget, seed);
        let fresh_layers = fresh.layers.clone();
        if fresh.crossings < best.crossings {
            best = fresh;
        }
        // Dummies start where the seed put them, where the search did, or where the unhinted search did.
        let candidates = [
            start.clone(),
            hinted_order(layered, &start, &best.layers),
            hinted_order(layered, &start, &fresh_layers),
        ];
        let mut kept = keep_hinted(layered, &candidates[0], budget);
        for candidate in &candidates[1..] {
            let next = keep_hinted(layered, candidate, budget);
            if next.crossings < kept.crossings {
                kept = next;
            }
        }
        if kept.crossings <= best.crossings {
            best = kept;
        }
    }
    Ordered {
        layers: best.layers,
        crossings: best.crossings,
    }
}

/// The search from one start, then from `budget.restarts` shuffles of it, keeping the order with the fewest crossings.
/// Each shuffle draws one value per unit but its first, so the shuffles of a sequential run use the stream of `seed` in
/// turn. Restart `r` takes its own generator at the place the sequential run would reach it, `r * draws` values in, so
/// it does not depend on the others or on the thread that runs it, and it shuffles as the sequential run does. The
/// results are merged in index order: a restart replaces the best only with strictly fewer crossings, so among equal
/// orders the lowest index wins.
fn search_from(layered: &LayeredGraph, start: &[Vec<usize>], budget: &Budget, seed: u32) -> Found {
    let mut best = refine(layered, start.to_vec(), budget);
    let draws: u64 = start
        .iter()
        .map(|layer| {
            let units = units_of(layer, &layered.block).len();
            u64::try_from(units.saturating_sub(1)).unwrap_or(u64::MAX)
        })
        .sum();
    let restarts = restart_searches(budget.restarts, |index| {
        let offset = u64::try_from(index).unwrap_or(u64::MAX).wrapping_mul(draws);
        let mut random = Mulberry32::after(seed, offset);
        let restart: Vec<Vec<usize>> = start
            .iter()
            .map(|layer| random.shuffled(&units_of(layer, &layered.block)).concat())
            .collect();
        refine(layered, restart, budget)
    });
    for candidate in restarts {
        if candidate.crossings < best.crossings {
            best = candidate;
        }
    }
    best
}

/// The searches of restarts `0..count`, in index order. With the `parallel` feature they run on rayon's global pool;
/// an indexed collect keeps the index order, so the result is the one the sequential build gives.
#[cfg(feature = "parallel")]
fn restart_searches<F>(count: usize, search: F) -> Vec<Found>
where
    F: Fn(usize) -> Found + Sync + Send,
{
    use rayon::prelude::*;
    (0..count).into_par_iter().map(search).collect()
}

/// The searches of restarts `0..count`, in index order, one after another.
#[cfg(not(feature = "parallel"))]
fn restart_searches<F>(count: usize, search: F) -> Vec<Found>
where
    F: Fn(usize) -> Found,
{
    (0..count).map(search).collect()
}

/// `found`'s order with each rank's real units put back in their `start` order, in the slots real units hold in
/// `found`; dummy units stay where the search put them.
fn hinted_order(
    layered: &LayeredGraph,
    start: &[Vec<usize>],
    found: &[Vec<usize>],
) -> Vec<Vec<usize>> {
    let is_real = |unit: &[usize]| layered.nodes[layered.block[unit[0]]].id.is_some();
    found
        .iter()
        .enumerate()
        .map(|(rank, layer)| {
            let hinted: Vec<Vec<usize>> = units_of(&start[rank], &layered.block)
                .into_iter()
                .filter(|unit| is_real(unit))
                .collect();
            let mut next = 0;
            let mut out = Vec::new();
            for unit in units_of(layer, &layered.block) {
                if is_real(&unit) {
                    out.extend(hinted[next].iter().copied());
                    next += 1;
                } else {
                    out.extend(unit);
                }
            }
            out
        })
        .collect()
}

/// The hinted order with its real nodes held in place and only the dummies sifted.
fn keep_hinted(layered: &LayeredGraph, layers: &[Vec<usize>], budget: &Budget) -> Found {
    let mut model = OrderModel::new(layered, layers.to_vec());
    gather_clusters(&mut model);
    sift(&mut model, budget.hinted_dummy_sift_rounds, |x| {
        layered.nodes[x].id.is_none()
    });
    found(&model)
}

/// Searches from one starting order, after sifting its dummies, then sifts the result.
fn refine(layered: &LayeredGraph, layers: Vec<Vec<usize>>, budget: &Budget) -> Found {
    let mut model = OrderModel::new(layered, layers);
    gather_clusters(&mut model);
    sift(&mut model, budget.dummy_sift_rounds, |x| {
        layered.nodes[x].id.is_none()
    });
    search(&mut model, budget.sweeps);
    sift(&mut model, budget.sift_rounds, |_| true);
    found(&model)
}
