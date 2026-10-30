//! Network simplex ranking: the constraint network, the longest-path start, and the pivot loop. A port of
//! `packages/graph-layout/src/rank/networkSimplex.ts` and `networkEdge.ts`.

use std::collections::BTreeMap;

use super::RankError;
use super::tree::{SpanningTree, feasible_tree};

/// A constraint `head - tail >= min_length`, costing `weight` per unit of span.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct NetworkEdge {
    pub(super) tail: usize,
    pub(super) head: usize,
    pub(super) min_length: f64,
    pub(super) weight: f64,
}

/// The slack of a constraint: how far its span exceeds the minimum. Zero means it is tight.
pub(super) fn slack(ranks: &[f64], e: NetworkEdge) -> f64 {
    ranks[e.head] - ranks[e.tail] - e.min_length
}

/// Ranks `count` nodes so that every edge's span is at least its `min_length` and the weighted sum of spans is least,
/// by the network simplex method of Gansner, Koutsofios, North and Vo (1993). Ranks are integers with the lowest real
/// node at 0. Each pivot keeps the ranks feasible, so stopping at `max_iterations` gives a valid, possibly non-optimal
/// ranking. The result depends only on the inputs: the search order is fixed.
pub(super) fn network_simplex(
    count: usize,
    edges: &[NetworkEdge],
    max_iterations: usize,
) -> Result<Vec<f64>, RankError> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let merged = merge_parallel(edges);
    let mut network = merged.clone();
    network.extend(root_edges(count, &merged));
    let mut ranks = longest_path_ranks(count + 1, &network)?;
    let tree_edges = feasible_tree(count + 1, &network, &mut ranks)?;
    let mut tree = SpanningTree::new(count + 1, &network, &tree_edges);
    pivot(&mut tree, &network, &mut ranks, max_iterations)?;
    Ok(normalise(&ranks[..count]))
}

/// Parallel edges become one: weights add and the longest minimum length wins. The first edge of each pair keeps its
/// place in the output.
fn merge_parallel(edges: &[NetworkEdge]) -> Vec<NetworkEdge> {
    let mut by_ends: BTreeMap<(usize, usize), usize> = BTreeMap::new();
    let mut merged: Vec<NetworkEdge> = Vec::new();
    for e in edges {
        if let Some(&i) = by_ends.get(&(e.tail, e.head)) {
            let seen = &mut merged[i];
            seen.weight += e.weight;
            seen.min_length = seen.min_length.max(e.min_length);
        } else {
            by_ends.insert((e.tail, e.head), merged.len());
            merged.push(*e);
        }
    }
    merged
}

/// Joins the components with a virtual root (node `count`): an edge of zero length and weight from the root to the
/// lowest node of each component, so the tree search reaches every node.
fn root_edges(count: usize, edges: &[NetworkEdge]) -> Vec<NetworkEdge> {
    let mut parent: Vec<usize> = (0..count).collect();
    for e in edges {
        let r = find(&mut parent, e.tail);
        let s = find(&mut parent, e.head);
        parent[r] = s;
    }
    let mut seen = vec![false; count];
    let mut joins = Vec::new();
    for v in 0..count {
        let root = find(&mut parent, v);
        if seen[root] {
            continue;
        }
        seen[root] = true;
        joins.push(NetworkEdge {
            tail: count,
            head: v,
            min_length: 0.0,
            weight: 0.0,
        });
    }
    joins
}

/// The union-find root of `v`, halving the path as it goes.
fn find(parent: &mut [usize], v: usize) -> usize {
    let mut x = v;
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// The longest path from a source to each node: feasible, and the start of the search.
fn longest_path_ranks(count: usize, edges: &[NetworkEdge]) -> Result<Vec<f64>, RankError> {
    let mut out = vec![Vec::new(); count];
    let mut indegree = vec![0usize; count];
    for (ei, e) in edges.iter().enumerate() {
        out[e.tail].push(ei);
        indegree[e.head] += 1;
    }
    let mut ranks = vec![0.0_f64; count];
    let mut queue: Vec<usize> = (0..count).filter(|&v| indegree[v] == 0).collect();
    let mut q = 0;
    while q < queue.len() {
        let v = queue[q];
        q += 1;
        for &ei in &out[v] {
            let e = edges[ei];
            ranks[e.head] = ranks[e.head].max(ranks[v] + e.min_length);
            indegree[e.head] -= 1;
            if indegree[e.head] == 0 {
                queue.push(e.head);
            }
        }
    }
    if queue.len() != count {
        return Err(RankError::Cycle);
    }
    Ok(ranks)
}

/// Exchanges tree edges while one has a negative cut value, up to `max_iterations` exchanges.
fn pivot(
    tree: &mut SpanningTree<'_>,
    edges: &[NetworkEdge],
    ranks: &mut [f64],
    max_iterations: usize,
) -> Result<(), RankError> {
    let mut cursor = 0;
    for _ in 0..max_iterations {
        let Some(slot) = leaving_slot(tree, cursor) else {
            return Ok(());
        };
        let leave = tree.tree_edges()[slot];
        let enter = entering_edge(tree, edges, ranks, leave).ok_or(RankError::Unbounded)?;
        shift_subtree(tree, edges, ranks, leave, enter);
        tree.exchange(leave, enter);
        cursor = slot + 1;
    }
    Ok(())
}

/// The first tree edge with a negative cut value, searching cyclically from `from`. Starting each search where the last
/// exchange left off keeps the pivots from cycling on one set of ties.
fn leaving_slot(tree: &SpanningTree<'_>, from: usize) -> Option<usize> {
    let len = tree.tree_edges().len();
    (0..len)
        .map(|k| (from + k) % len)
        .find(|&slot| tree.cut(tree.tree_edges()[slot]) < 0.0)
}

/// The non-tree edge with the least slack that runs from the head side of `leave` to its tail side. Such an edge exists
/// whenever the cut value is negative. Ties go to the lowest edge index.
fn entering_edge(
    tree: &SpanningTree<'_>,
    edges: &[NetworkEdge],
    ranks: &[f64],
    leave: usize,
) -> Option<usize> {
    let child = tree.child_of(leave);
    let head_is_child = child == edges[leave].head;
    let mut best: Option<usize> = None;
    let mut best_slack = f64::INFINITY;
    for (ei, x) in edges.iter().enumerate() {
        if tree.is_tree(ei) {
            continue;
        }
        let tail_below = tree.in_subtree(child, x.tail) == head_is_child;
        let head_below = tree.in_subtree(child, x.head) == head_is_child;
        if !tail_below || head_below {
            continue;
        }
        let s = slack(ranks, *x);
        if s < best_slack {
            best_slack = s;
            best = Some(ei);
        }
    }
    best
}

/// Makes `enter` tight by moving the subtree below `leave` (the head side, when the head is the child). Its slack is
/// the shift, and the tree edge then leaves the cycle that `enter` closes.
fn shift_subtree(
    tree: &SpanningTree<'_>,
    edges: &[NetworkEdge],
    ranks: &mut [f64],
    leave: usize,
    enter: usize,
) {
    let s = slack(ranks, edges[enter]);
    let child = tree.child_of(leave);
    let shift = if child == edges[leave].head { s } else { -s };
    for (v, rank) in ranks.iter_mut().enumerate() {
        if tree.in_subtree(child, v) {
            *rank += shift;
        }
    }
}

/// Shifts the ranks so the lowest is 0.
fn normalise(ranks: &[f64]) -> Vec<f64> {
    let low = ranks.iter().fold(f64::INFINITY, |least, &r| least.min(r));
    ranks.iter().map(|&r| r - low).collect()
}
