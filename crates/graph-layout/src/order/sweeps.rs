//! The search over orders: alternating sweeps, each followed by transposition, keeping the order with the fewest
//! crossings seen. A downward sweep places each node by the weighted median of its upper neighbours and an upward sweep
//! by their weighted barycentre (Eades and Wormald, Algorithmica 11, 1994). A port of `order/sweeps.ts`.

use super::clusters::{arrange_rank, arrangement};
use super::crossings::total_crossings;
use super::model::{OrderModel, as_f64, ascending};
use super::transpose::transpose;

/// An order of the layered nodes with its weighted crossings.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Found {
    pub(crate) layers: Vec<Vec<usize>>,
    pub(crate) crossings: f64,
}

/// The order the model is in, copied, with its crossings.
pub(crate) fn found(model: &OrderModel<'_>) -> Found {
    Found {
        layers: model.layers.clone(),
        crossings: total_crossings(model),
    }
}

/// Searches by up to `count` sweeps, stopping early at zero crossings or at a fixed point, and leaves the model at the
/// best order. A sweep followed by transposition is a function of the order and the direction, and the directions
/// alternate: two sweeps in a row that change nothing leave the order where it is for every later sweep, so the search
/// ends there with the same result it would reach by running them all.
pub(crate) fn search(model: &mut OrderModel<'_>, count: usize) -> Found {
    let mut best = found(model);
    let mut it = 0;
    let mut unchanged = 0;
    while it < count && best.crossings > 0.0 && unchanged < 2 {
        let downward = it % 2 == 0;
        let before = model.layers.clone();
        sweep(model, downward, downward);
        transpose(model);
        unchanged = if model.layers == before {
            unchanged + 1
        } else {
            0
        };
        let current = found(model);
        if current.crossings < best.crossings {
            best = current;
        }
        it += 1;
    }
    for (rank, layer) in best.layers.iter().enumerate() {
        model.set_layer(rank, layer.clone());
    }
    best
}

/// Reorders each rank in turn by the target of each node: a weighted median when `median` is set, otherwise a weighted
/// barycentre. A node with no neighbour in the rank the sweep came from keeps its place.
fn sweep(model: &mut OrderModel<'_>, downward: bool, median: bool) {
    let ranks = model.layers.len();
    let visit: Vec<usize> = if downward {
        (1..ranks).collect()
    } else {
        (0..ranks.saturating_sub(1)).rev().collect()
    };
    let context = arrangement(model);
    for rank in (0..ranks).filter(|rank| !visit.contains(rank)) {
        arrange_rank(model, rank, &context, |m, unit| as_f64(m.index[unit[0]]));
    }
    for &rank in &visit {
        arrange_rank(model, rank, &context, |m, unit| {
            target(m, unit, downward, median).unwrap_or(as_f64(m.index[unit[0]]))
        });
    }
}

/// The position a unit aims for: the weighted median or barycentre of the positions its members' neighbours in the
/// reference rank take, each read at its port's offset. `None` when no member has a neighbour there.
fn target(
    model: &OrderModel<'_>,
    members: &[usize],
    from_above: bool,
    median: bool,
) -> Option<f64> {
    let reads: Vec<Read> = members
        .iter()
        .flat_map(|&x| {
            let links = if from_above {
                &model.up[x]
            } else {
                &model.down[x]
            };
            links.iter()
        })
        .map(|&si| {
            let s = model.graph.segments[si];
            if from_above {
                Read {
                    at: model.slot(s.top, s.top_offset),
                    weight: s.weight,
                }
            } else {
                Read {
                    at: model.slot(s.bottom, s.bottom_offset),
                    weight: s.weight,
                }
            }
        })
        .collect();
    if reads.is_empty() {
        return None;
    }
    if median {
        weighted_median(&reads)
    } else {
        weighted_mean(&reads)
    }
}

#[derive(Debug, Clone, Copy)]
struct Read {
    at: f64,
    weight: f64,
}

fn weighted_mean(reads: &[Read]) -> Option<f64> {
    let total = reads.iter().fold(0.0, |sum, r| sum + r.weight);
    if total <= 0.0 {
        return None;
    }
    Some(reads.iter().fold(0.0, |sum, r| sum + r.weight * r.at) / total)
}

/// The weighted median; halfway between the two middle reads when the weight splits exactly in half.
fn weighted_median(reads: &[Read]) -> Option<f64> {
    let mut sorted = reads.to_vec();
    sorted.sort_by(|a, b| ascending(a.at, b.at));
    let total = sorted.iter().fold(0.0, |sum, r| sum + r.weight);
    if total <= 0.0 {
        return None;
    }
    let mut acc = 0.0;
    for (i, read) in sorted.iter().enumerate() {
        acc += read.weight;
        if 2.0 * acc > total {
            return Some(read.at);
        }
        if (2.0 * acc).total_cmp(&total).is_eq() {
            let next = sorted.get(i + 1).map_or(read.at, |r| r.at);
            return Some(f64::midpoint(read.at, next));
        }
    }
    None
}
