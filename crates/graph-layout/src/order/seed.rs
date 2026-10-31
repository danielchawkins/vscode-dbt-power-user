//! The starting order of each rank, as layered node indices. With hints, a node the hints know sorts by its hinted order,
//! and a node they do not know sits where its neighbours sit along their ranks (North and Woodhull, GD 2001). Without
//! hints the order is depth-first from the top rank, so a node follows the nodes it feeds. A port of `order/seed.ts`.
//!
//! A lateral port's dummy is ordered as a unit with its owner (`model.rs`), so the hints need no port rule.

use std::collections::BTreeMap;

use super::model::{as_f64, ascending};
use crate::layering::LayeredGraph;

/// Passes in which a node without a place takes the mean of its neighbours' places, so chains of new nodes settle.
const NEIGHBOUR_PASSES: usize = 3;

/// The key of a node that nothing reaches: it sorts after every keyed node of its rank (`Number.MAX_SAFE_INTEGER`).
const UNKEYED: f64 = 9_007_199_254_740_991.0;

/// The hinted in-rank order of each real node, by its id (the index of the node in the input graph).
pub(crate) type Hints = BTreeMap<usize, f64>;

/// The starting order of each rank, left to right, from the hints or the depth-first walk.
pub(crate) fn starting_layers(graph: &LayeredGraph, hints: Option<&Hints>) -> Vec<Vec<usize>> {
    let keys = match hints {
        None => depth_first_keys(graph),
        Some(hints) => hint_keys(graph, hints),
    };
    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); graph.ranks];
    for (x, node) in graph.nodes.iter().enumerate() {
        if graph.block[x] == x {
            layers[node.rank].push(x);
        }
    }
    for layer in &mut layers {
        layer.sort_by(|&a, &b| ascending(keys[a], keys[b]).then(a.cmp(&b)));
    }
    layers
}

/// Each node's key on the scale of its own rank. A hinted node keeps its previous order: it takes the centre of its cell
/// among the hinted nodes of its rank, so a rank of `n` hinted nodes spans [0, n]. Any other node takes the mean
/// fraction of its neighbours, a position in [0, 1] along its rank, so it never compares with another rank's order.
fn hint_keys(graph: &LayeredGraph, hints: &Hints) -> Vec<f64> {
    let count = graph.nodes.len();
    let hinted: Vec<Option<f64>> = graph
        .nodes
        .iter()
        .map(|node| node.id.and_then(|id| hints.get(&id).copied()))
        .collect();
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); graph.ranks];
    for (x, node) in graph.nodes.iter().enumerate() {
        if hinted[x].is_some() {
            members[node.rank].push(x);
        }
    }
    let mut fractions: Vec<Option<f64>> = vec![None; count];
    for list in &mut members {
        list.sort_by(|&a, &b| {
            ascending(hinted[a].unwrap_or(0.0), hinted[b].unwrap_or(0.0)).then(a.cmp(&b))
        });
        let n = as_f64(list.len());
        for (k, &x) in list.iter().enumerate() {
            fractions[x] = Some((as_f64(k) + 0.5) / n);
        }
    }
    let neighbours = neighbour_lists(graph);
    for _ in 0..NEIGHBOUR_PASSES {
        for x in 0..count {
            if fractions[x].is_some() {
                continue;
            }
            let known: Vec<f64> = neighbours[x].iter().filter_map(|&y| fractions[y]).collect();
            if !known.is_empty() {
                fractions[x] = Some(known.iter().fold(0.0, |sum, f| sum + f) / as_f64(known.len()));
            }
        }
    }
    graph
        .nodes
        .iter()
        .enumerate()
        .map(|(x, node)| match fractions[x] {
            None => UNKEYED,
            Some(fraction) => fraction * as_f64(members[node.rank].len().max(1)),
        })
        .collect()
}

/// The position of each node in a depth-first walk from the top rank down, rank by rank.
fn depth_first_keys(graph: &LayeredGraph) -> Vec<f64> {
    let count = graph.nodes.len();
    let mut lower: Vec<Vec<usize>> = vec![Vec::new(); count];
    for s in &graph.segments {
        lower[s.top].push(s.bottom);
    }
    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); graph.ranks];
    for (x, node) in graph.nodes.iter().enumerate() {
        layers[node.rank].push(x);
    }
    let mut keys = vec![UNKEYED; count];
    let mut seen = vec![false; count];
    let mut next = 0_usize;
    for layer in &layers {
        for &start in layer {
            let mut stack = vec![start];
            while let Some(x) = stack.pop() {
                if seen[x] {
                    continue;
                }
                seen[x] = true;
                keys[x] = as_f64(next);
                next += 1;
                stack.extend(lower[x].iter().copied());
            }
        }
    }
    keys
}

/// The nodes linked to each node by a segment, in either direction, in segment order.
fn neighbour_lists(graph: &LayeredGraph) -> Vec<Vec<usize>> {
    let mut lists: Vec<Vec<usize>> = vec![Vec::new(); graph.nodes.len()];
    for s in &graph.segments {
        lists[s.top].push(s.bottom);
        lists[s.bottom].push(s.top);
    }
    lists
}
