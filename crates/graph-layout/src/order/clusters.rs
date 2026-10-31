//! Cluster-aware arrangement of units: each cluster's units form one block, placed by the block key of the cluster, and
//! a nested cluster's units are arranged the same way inside it. A port of `order/clusters.ts`. The graphs this phase
//! reads carry no cluster chains yet, so every chain is empty and the arrangement is a stable sort by key.

use std::collections::{BTreeMap, BTreeSet};

use super::model::{OrderModel, as_f64, ascending, units_of};
use crate::layering::LayeredGraph;

/// What a cluster-aware arrangement knows: each node's cluster chain, and the sort key of each cluster's block. A
/// block's key is the same in every rank, so sibling clusters keep one order across the drawing.
pub(crate) struct Arrangement<'a> {
    pub(crate) paths: &'a [Vec<usize>],
    pub(crate) block_keys: Vec<f64>,
}

/// A unit with its cluster chain, its sort key and its place in the input, for ties.
#[derive(Clone, Copy)]
struct Item<'a> {
    unit: &'a [usize],
    path: &'a [usize],
    key: f64,
    order: usize,
}

/// A unit, or the block of one cluster's units, placed by its key.
struct Entry {
    key: f64,
    order: usize,
    units: Vec<Vec<usize>>,
}

/// Arranges items whose chains agree up to `depth`, grouping them by their cluster at `depth`. Blocks are kept in the
/// order their first member appears, and entries sort by key, then by cluster or unit index, then by input position.
fn arrange_at(context: &Arrangement<'_>, items: &[Item<'_>], depth: usize) -> Vec<Vec<usize>> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut blocks: Vec<(usize, Vec<Item<'_>>)> = Vec::new();
    let mut block_of: BTreeMap<usize, usize> = BTreeMap::new();
    for &item in items {
        match item.path.get(depth) {
            None => entries.push(Entry {
                key: item.key,
                order: item.order,
                units: vec![item.unit.to_vec()],
            }),
            Some(&cluster) => {
                if let Some(&at) = block_of.get(&cluster) {
                    blocks[at].1.push(item);
                } else {
                    block_of.insert(cluster, blocks.len());
                    blocks.push((cluster, vec![item]));
                }
            }
        }
    }
    for (cluster, members) in blocks {
        entries.push(Entry {
            key: context.block_keys[cluster],
            order: cluster,
            units: arrange_at(context, &members, depth + 1),
        });
    }
    entries.sort_by(|a, b| ascending(a.key, b.key).then(a.order.cmp(&b.order)));
    entries.into_iter().flat_map(|entry| entry.units).collect()
}

/// Orders `units` by `keys`, with their clusters gathered: `keys[i]` is the key of `units[i]`.
fn arrange(context: &Arrangement<'_>, units: &[Vec<usize>], keys: &[f64]) -> Vec<Vec<usize>> {
    let items: Vec<Item<'_>> = units
        .iter()
        .enumerate()
        .map(|(i, unit)| Item {
            unit,
            path: context.paths[unit[0]].as_slice(),
            key: keys[i],
            order: i,
        })
        .collect();
    arrange_at(context, &items, 0)
}

/// The block key of each cluster: the mean position of its members over the whole order, so a cluster sorts the same
/// way in every rank. A cluster with no members has key 0.
fn cluster_keys(model: &OrderModel<'_>) -> Vec<f64> {
    let mut sums: Vec<(f64, usize)> = Vec::new();
    for (x, path) in model.graph.paths.iter().enumerate() {
        for &cluster in path {
            if sums.len() <= cluster {
                sums.resize(cluster + 1, (0.0, 0));
            }
            sums[cluster].0 += as_f64(model.index[x]);
            sums[cluster].1 += 1;
        }
    }
    sums.iter()
        .map(|&(total, count)| {
            if count == 0 {
                0.0
            } else {
                total / as_f64(count)
            }
        })
        .collect()
}

/// The arrangement of `model`'s clusters, with their block keys as they stand.
pub(crate) fn arrangement<'a>(model: &OrderModel<'a>) -> Arrangement<'a> {
    let graph: &'a LayeredGraph = model.graph;
    Arrangement {
        paths: &graph.paths,
        block_keys: cluster_keys(model),
    }
}

/// Reorders one rank by the key of each of its units, with its clusters gathered and placed by `context`.
pub(crate) fn arrange_rank(
    model: &mut OrderModel<'_>,
    rank: usize,
    context: &Arrangement<'_>,
    key_of: impl Fn(&OrderModel<'_>, &[usize]) -> f64,
) {
    let units = units_of(&model.layers[rank], model.graph.block.as_slice());
    let keys: Vec<f64> = units.iter().map(|unit| key_of(model, unit)).collect();
    let layer = arrange(context, &units, &keys).concat();
    model.set_layer(rank, layer);
}

/// Gathers each rank's clusters into contiguous blocks, keeping the order of each unit's place.
pub(crate) fn gather_clusters(model: &mut OrderModel<'_>) {
    let context = arrangement(model);
    for rank in 0..model.layers.len() {
        arrange_rank(model, rank, &context, |m, unit| as_f64(m.index[unit[0]]));
    }
}

/// Whether two units lie in the same innermost cluster, so that swapping them keeps every cluster contiguous.
pub(crate) fn same_chain(a: &[usize], b: &[usize]) -> bool {
    a == b
}

/// The slots at which a unit with chain `own` may be placed among `others`, the other units' chains in order, the unit
/// now sitting at slot `here`: slot k puts the unit after the first k of them. A slot is legal when the unit can reach it
/// without passing a sibling unit, and it keeps every cluster contiguous.
pub(crate) fn legal_slots(own: &[usize], others: &[&[usize]], here: usize) -> Vec<bool> {
    let present: BTreeSet<usize> = others
        .iter()
        .flat_map(|chain| chain.iter().copied())
        .collect();
    let reach = passable(own, others, here);
    (0..=others.len())
        .map(|k| {
            let left: &[usize] = if k > 0 { others[k - 1] } else { &[] };
            let right: &[usize] = if k < others.len() { others[k] } else { &[] };
            reach[k] && legal_between(own, left, right, &present)
        })
        .collect()
}

/// Whether a unit may reach each slot from `here` without passing a sibling of `own`.
fn passable(own: &[usize], others: &[&[usize]], here: usize) -> Vec<bool> {
    let mut reach = vec![false; others.len() + 1];
    reach[here] = true;
    for k in here + 1..=others.len() {
        reach[k] = reach[k - 1] && !siblings(own, others[k - 1]);
    }
    for k in (0..here).rev() {
        reach[k] = reach[k + 1] && !siblings(own, others[k]);
    }
    reach
}

/// Whether two chains part at some depth, so that their units are siblings: passing one flips their order.
fn siblings(a: &[usize], b: &[usize]) -> bool {
    let depth = a.len().min(b.len());
    a[..depth].iter().zip(&b[..depth]).any(|(c, d)| c != d)
}

fn legal_between(
    own: &[usize],
    left: &[usize],
    right: &[usize],
    present: &BTreeSet<usize>,
) -> bool {
    let beside = |c: &usize| left.contains(c) || right.contains(c);
    own.iter().all(|c| !present.contains(c) || beside(c))
        && left.iter().all(|c| !right.contains(c) || own.contains(c))
}
