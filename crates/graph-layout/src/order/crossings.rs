//! The weighted crossings of an order, by the accumulator tree of a Fenwick tree (Barth, Jünger and Mutzel, JGAA 8(2),
//! 2004). A port of `order/crossings.ts`. Two links cross when their order at the upper rank and at the lower rank
//! differ strictly; a crossing counts the product of the two weights. Links that share a position at either rank do not
//! cross. Every sum is taken in the order of the TypeScript loops, so each total equals TypeScript's bit for bit.

use super::fenwick::Fenwick;
use super::model::{OrderModel, ascending};

/// A link between two adjacent ranks: its position at the upper rank, at the lower rank, and its weight.
type Link = (f64, f64, f64);

/// The weighted number of crossings among links between two adjacent ranks.
pub(crate) fn count_crossings(links: &[Link]) -> f64 {
    let mut sorted = links.to_vec();
    // A stable sort by the two positions: ties keep their input order, as `sortedInInputOrder` does.
    sorted.sort_by(|a, b| ascending(a.0, b.0).then(ascending(a.1, b.1)));
    let mut lowers: Vec<f64> = sorted.iter().map(|link| link.1).collect();
    lowers.sort_by(|a, b| ascending(*a, *b));
    lowers.dedup();
    let mut tree = Fenwick::new(lowers.len());
    let mut seen = 0.0;
    let mut total = 0.0;
    for &(_, lower, weight) in &sorted {
        let k = lowers
            .binary_search_by(|v| ascending(*v, lower))
            .expect("every lower position is in the column list");
        total += weight * (seen - tree.prefix(k + 1));
        tree.add(k, weight);
        seen += weight;
    }
    total
}

/// The weighted crossings between the links of `rank` and the rank below it.
pub(crate) fn rank_crossings(model: &OrderModel<'_>, rank: usize) -> f64 {
    let segments = &model.graph.segments;
    let mut links: Vec<Link> = Vec::new();
    for &x in &model.layers[rank] {
        for &si in &model.down[x] {
            let s = segments[si];
            links.push((
                model.slot(x, s.top_offset),
                model.slot(s.bottom, s.bottom_offset),
                s.weight,
            ));
        }
    }
    count_crossings(&links)
}

/// The weighted crossings of the whole drawing: the sum of the crossings of each pair of adjacent ranks, in rank order.
pub(crate) fn total_crossings(model: &OrderModel<'_>) -> f64 {
    (0..model.layers.len().saturating_sub(1))
        .fold(0.0, |total, rank| total + rank_crossings(model, rank))
}
