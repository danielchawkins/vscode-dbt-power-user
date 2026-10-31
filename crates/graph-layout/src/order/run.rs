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
fn search_from(layered: &LayeredGraph, start: &[Vec<usize>], budget: &Budget, seed: u32) -> Found {
    let mut random = Mulberry32::new(seed);
    let mut best = refine(layered, start.to_vec(), budget);
    for _ in 0..budget.restarts {
        let restart: Vec<Vec<usize>> = start
            .iter()
            .map(|layer| random.shuffled(&units_of(layer, &layered.block)).concat())
            .collect();
        let candidate = refine(layered, restart, budget);
        if candidate.crossings < best.crossings {
            best = candidate;
        }
    }
    best
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
