//! Network simplex ranking: the constraint network, the longest-path start, and the pivot loop. A port of
//! `packages/graph-layout/src/rank/networkSimplex.ts` and `networkEdge.ts`.

use super::RankError;
use super::reset_lists;
use super::tree::{Tree, feasible_tree};

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

/// The buffers that network simplex reuses between calls: the merged and joined network, the longest-path start, the
/// spanning tree, and the result. Every buffer is cleared, not reallocated, so a warm one allocates nothing for the
/// same network.
#[derive(Debug, Default)]
pub(super) struct Simplex {
    keys: Vec<(usize, usize, usize)>,
    reps: Vec<(usize, NetworkEdge)>,
    merged: Vec<NetworkEdge>,
    joins: Vec<NetworkEdge>,
    network: Vec<NetworkEdge>,
    parent: Vec<usize>,
    seen: Vec<bool>,
    out: Vec<Vec<usize>>,
    indegree: Vec<usize>,
    queue: Vec<usize>,
    ranks: Vec<f64>,
    tree: Tree,
    result: Vec<f64>,
}

/// Ranks `count` nodes so that every edge's span is at least its `min_length` and the weighted sum of spans is least,
/// by the network simplex method of Gansner, Koutsofios, North and Vo (1993). Ranks are integers with the lowest real
/// node at 0. Each pivot keeps the ranks feasible, so stopping at `max_iterations` gives a valid, possibly non-optimal
/// ranking. The result depends only on the inputs: the search order is fixed. The result is borrowed from `scratch`.
pub(super) fn network_simplex<'s>(
    count: usize,
    edges: &[NetworkEdge],
    max_iterations: usize,
    scratch: &'s mut Simplex,
) -> Result<&'s [f64], RankError> {
    if count == 0 {
        scratch.result.clear();
        return Ok(&scratch.result);
    }
    scratch.merge_parallel(edges);
    scratch.root_edges(count);
    scratch.network.clear();
    scratch.network.extend_from_slice(&scratch.merged);
    scratch.network.extend_from_slice(&scratch.joins);
    scratch.longest_path(count + 1)?;
    let Simplex {
        network,
        ranks,
        tree,
        result,
        ..
    } = scratch;
    feasible_tree(count + 1, network, ranks, tree)?;
    tree.prepare(count + 1, network);
    pivot(tree, network, ranks, max_iterations)?;
    normalise(&ranks[..count], result);
    Ok(result)
}

impl Simplex {
    /// Parallel edges become one: weights add and the longest minimum length wins. The first edge of each pair keeps its
    /// place in the output. Edges are grouped by their ends after a sort, and the weights are added in input order, as
    /// the first-seen merge adds them.
    fn merge_parallel(&mut self, edges: &[NetworkEdge]) {
        self.keys.clear();
        self.keys
            .extend(edges.iter().enumerate().map(|(i, e)| (e.tail, e.head, i)));
        self.keys.sort_unstable();
        self.reps.clear();
        let mut k = 0;
        while k < self.keys.len() {
            let (tail, head, first) = self.keys[k];
            let mut merged = edges[first];
            k += 1;
            while k < self.keys.len() && self.keys[k].0 == tail && self.keys[k].1 == head {
                let e = edges[self.keys[k].2];
                merged.weight += e.weight;
                merged.min_length = merged.min_length.max(e.min_length);
                k += 1;
            }
            self.reps.push((first, merged));
        }
        // The first indices are distinct, so the order is total.
        self.reps.sort_unstable_by_key(|&(first, _)| first);
        self.merged.clear();
        self.merged.extend(self.reps.iter().map(|&(_, e)| e));
    }

    /// Joins the components of the merged edges with a virtual root (node `count`): an edge of zero length and weight
    /// from the root to the lowest node of each component, so the tree search reaches every node.
    fn root_edges(&mut self, count: usize) {
        self.parent.clear();
        self.parent.extend(0..count);
        for e in &self.merged {
            let r = find(&mut self.parent, e.tail);
            let s = find(&mut self.parent, e.head);
            self.parent[r] = s;
        }
        self.seen.clear();
        self.seen.resize(count, false);
        self.joins.clear();
        for v in 0..count {
            let root = find(&mut self.parent, v);
            if self.seen[root] {
                continue;
            }
            self.seen[root] = true;
            self.joins.push(NetworkEdge {
                tail: count,
                head: v,
                min_length: 0.0,
                weight: 0.0,
            });
        }
    }

    /// The longest path from a source to each node of the network: feasible, and the start of the search. Writes
    /// `ranks`.
    fn longest_path(&mut self, count: usize) -> Result<(), RankError> {
        reset_lists(&mut self.out, count);
        self.indegree.clear();
        self.indegree.resize(count, 0);
        for (ei, e) in self.network.iter().enumerate() {
            self.out[e.tail].push(ei);
            self.indegree[e.head] += 1;
        }
        self.ranks.clear();
        self.ranks.resize(count, 0.0);
        self.queue.clear();
        for v in 0..count {
            if self.indegree[v] == 0 {
                self.queue.push(v);
            }
        }
        let mut q = 0;
        while q < self.queue.len() {
            let v = self.queue[q];
            q += 1;
            for &ei in &self.out[v] {
                let e = self.network[ei];
                self.ranks[e.head] = self.ranks[e.head].max(self.ranks[v] + e.min_length);
                self.indegree[e.head] -= 1;
                if self.indegree[e.head] == 0 {
                    self.queue.push(e.head);
                }
            }
        }
        if self.queue.len() != count {
            return Err(RankError::Cycle);
        }
        Ok(())
    }
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

/// Exchanges tree edges while one has a negative cut value, up to `max_iterations` exchanges.
fn pivot(
    tree: &mut Tree,
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
        tree.exchange(edges, leave, enter);
        cursor = slot + 1;
    }
    Ok(())
}

/// The first tree edge with a negative cut value, searching cyclically from `from`. Starting each search where the last
/// exchange left off keeps the pivots from cycling on one set of ties.
fn leaving_slot(tree: &Tree, from: usize) -> Option<usize> {
    let len = tree.tree_edges().len();
    (0..len)
        .map(|k| (from + k) % len)
        .find(|&slot| tree.cut(tree.tree_edges()[slot]) < 0.0)
}

/// The non-tree edge with the least slack that runs from the head side of `leave` to its tail side. Such an edge exists
/// whenever the cut value is negative. Ties go to the lowest edge index.
fn entering_edge(tree: &Tree, edges: &[NetworkEdge], ranks: &[f64], leave: usize) -> Option<usize> {
    let child = tree.child_of(edges, leave);
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
    tree: &Tree,
    edges: &[NetworkEdge],
    ranks: &mut [f64],
    leave: usize,
    enter: usize,
) {
    let s = slack(ranks, edges[enter]);
    let child = tree.child_of(edges, leave);
    let shift = if child == edges[leave].head { s } else { -s };
    for (v, rank) in ranks.iter_mut().enumerate() {
        if tree.in_subtree(child, v) {
            *rank += shift;
        }
    }
}

/// Shifts the ranks so the lowest is 0, into `out`.
fn normalise(ranks: &[f64], out: &mut Vec<f64>) {
    let low = ranks.iter().fold(f64::INFINITY, |least, &r| least.min(r));
    out.clear();
    out.extend(ranks.iter().map(|&r| r - low));
}
