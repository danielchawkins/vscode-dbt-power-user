//! The spanning tree that network simplex pivots on, and the feasible tight tree that starts it. Ports
//! `packages/graph-layout/src/rank/feasibleTree.ts` and `spanningTree.ts`.

use super::RankError;
use super::network::{NetworkEdge, slack};
use super::reset_lists;

/// The buffers of the feasible-tree build and of the spanning tree. [`feasible_tree`] fills the tree edges, and
/// [`Tree::prepare`] numbers the tree that they form. Every buffer is cleared, not reallocated, so a warm tree allocates
/// nothing for the same network.
#[derive(Debug, Default)]
pub(super) struct Tree {
    incident: Vec<Vec<usize>>,
    reached: Vec<bool>,
    members: Vec<usize>,
    stack: Vec<usize>,
    adjacent: Vec<Vec<usize>>,
    parent_edge: Vec<Option<usize>>,
    low: Vec<usize>,
    lim: Vec<usize>,
    cut: Vec<f64>,
    pub(super) chosen: Vec<usize>,
    slot_of: Vec<Option<usize>>,
    cursor: Vec<usize>,
    numbering: Vec<usize>,
}

/// Builds a feasible tight spanning tree, as in Gansner, Koutsofios, North and Vo (1993). Starting from node 0, the
/// tree takes every edge with zero slack that reaches a new node. When none is left, the smallest slack on an edge
/// leaving the tree is closed by shifting the whole tree; that keeps every other edge feasible. `ranks` must be
/// feasible on entry and is updated in place. The tree edges are left in `tree`, one per node but the first.
pub(super) fn feasible_tree(
    count: usize,
    edges: &[NetworkEdge],
    ranks: &mut [f64],
    tree: &mut Tree,
) -> Result<(), RankError> {
    reset_lists(&mut tree.incident, count);
    for (ei, e) in edges.iter().enumerate() {
        tree.incident[e.tail].push(ei);
        tree.incident[e.head].push(ei);
    }
    tree.reached.clear();
    tree.reached.resize(count, false);
    tree.members.clear();
    tree.chosen.clear();
    if count > 0 {
        tree.reached[0] = true;
        tree.members.push(0);
    }
    let mut build = TreeBuild {
        edges,
        incident: &tree.incident,
        ranks,
        in_tree: &mut tree.reached,
        members: &mut tree.members,
        stack: &mut tree.stack,
        tree_edges: &mut tree.chosen,
    };
    while build.members.len() < count {
        build.grow_tight();
        if build.members.len() < count {
            build.close_gap()?;
        }
    }
    Ok(())
}

/// The state of the feasible-tree build: the tree so far and the ranks, which the closing shifts move in place.
struct TreeBuild<'a> {
    edges: &'a [NetworkEdge],
    incident: &'a [Vec<usize>],
    ranks: &'a mut [f64],
    in_tree: &'a mut [bool],
    members: &'a mut Vec<usize>,
    stack: &'a mut Vec<usize>,
    tree_edges: &'a mut Vec<usize>,
}

impl TreeBuild<'_> {
    /// Adds, by depth-first search, every node reachable from the tree over zero-slack edges.
    fn grow_tight(&mut self) {
        self.stack.clear();
        self.stack.extend_from_slice(self.members);
        while let Some(x) = self.stack.pop() {
            for &ei in &self.incident[x] {
                let e = self.edges[ei];
                let y = if e.tail == x { e.head } else { e.tail };
                if self.in_tree[y] || slack(self.ranks, e) != 0.0 {
                    continue;
                }
                self.in_tree[y] = true;
                self.members.push(y);
                self.tree_edges.push(ei);
                self.stack.push(y);
            }
        }
    }

    /// Shifts the tree so that the crossing edge with the least slack becomes tight. A tail inside the tree moves the
    /// tree up by the slack; a head inside the tree moves it down. Every crossing edge stays feasible.
    fn close_gap(&mut self) -> Result<(), RankError> {
        let mut best: Option<usize> = None;
        let mut best_slack = f64::INFINITY;
        for (ei, e) in self.edges.iter().enumerate() {
            if self.in_tree[e.tail] == self.in_tree[e.head] {
                continue;
            }
            let s = slack(self.ranks, *e);
            if s < best_slack {
                best_slack = s;
                best = Some(ei);
            }
        }
        let best = best.ok_or(RankError::Disconnected)?;
        let shift = if self.in_tree[self.edges[best].tail] {
            best_slack
        } else {
            -best_slack
        };
        for &v in self.members.iter() {
            self.ranks[v] += shift;
        }
        Ok(())
    }
}

impl Tree {
    /// The tree edges, in a fixed slot order that a search can cycle through.
    pub(super) fn tree_edges(&self) -> &[usize] {
        &self.chosen
    }

    pub(super) fn is_tree(&self, ei: usize) -> bool {
        self.slot_of[ei].is_some()
    }

    /// The cut value of a tree edge: negative means moving the tail-side component's end of it lowers the length.
    pub(super) fn cut(&self, ei: usize) -> f64 {
        self.cut[ei]
    }

    /// The endpoint of tree edge `ei` that lies further from the root.
    pub(super) fn child_of(&self, edges: &[NetworkEdge], ei: usize) -> usize {
        let e = edges[ei];
        if self.parent_edge[e.tail] == Some(ei) {
            e.tail
        } else {
            e.head
        }
    }

    /// True when node `x` lies in the subtree hanging below node `v`.
    pub(super) fn in_subtree(&self, v: usize, x: usize) -> bool {
        self.low[v] <= self.lim[x] && self.lim[x] <= self.lim[v]
    }

    /// Makes the tree edges of `tree_edges` (already set by [`feasible_tree`]) the spanning tree of the `count` nodes
    /// of `edges`, rooted at node 0: the adjacency, the postorder numbers and the cut values are computed from them.
    pub(super) fn prepare(&mut self, count: usize, edges: &[NetworkEdge]) {
        reset_lists(&mut self.adjacent, count);
        self.parent_edge.clear();
        self.parent_edge.resize(count, None);
        self.low.clear();
        self.low.resize(count, 0);
        self.lim.clear();
        self.lim.resize(count, 0);
        self.cut.clear();
        self.cut.resize(edges.len(), 0.0);
        self.slot_of.clear();
        self.slot_of.resize(edges.len(), None);
        for (slot, &ei) in self.chosen.iter().enumerate() {
            self.slot_of[ei] = Some(slot);
            self.adjacent[edges[ei].tail].push(ei);
            self.adjacent[edges[ei].head].push(ei);
        }
        self.number(edges, 0, 0);
        for slot in 0..self.chosen.len() {
            let f = self.chosen[slot];
            let cut = self.cut_of(edges, f);
            self.cut[f] = cut;
        }
    }

    /// Swaps tree edge `leave` for the non-tree edge `enter`, whose ends lie on the two sides `leave` separates. The
    /// cut values on the cycle that `enter` closes are updated first, while the old numbering still holds.
    pub(super) fn exchange(&mut self, edges: &[NetworkEdge], leave: usize, enter: usize) {
        let cut_leave = self.cut[leave];
        let en = edges[enter];
        let lca = self.walk(edges, en.tail, en.head, cut_leave);
        self.walk(edges, en.head, en.tail, -cut_leave);
        self.cut[enter] = -cut_leave;
        self.cut[leave] = 0.0;
        self.replace(edges, leave, enter);
        let first = self.low[lca];
        self.number(edges, lca, first);
    }

    /// The cut of a tree edge, computed from scratch: the sum over every edge that crosses the cut it makes.
    fn cut_of(&self, edges: &[NetworkEdge], f: usize) -> f64 {
        let child = self.child_of(edges, f);
        let tail_is_child = child == edges[f].tail;
        let mut sum = 0.0;
        for x in edges {
            let tail_in = self.in_subtree(child, x.tail);
            if tail_in == self.in_subtree(child, x.head) {
                continue;
            }
            let sign = if tail_in == tail_is_child { 1.0 } else { -1.0 };
            sum += sign * x.weight;
        }
        sum
    }

    /// Climbs from `v` to the first ancestor whose subtree holds `target`, adding `sign * scaled` to each tree edge on
    /// the way, where `sign` is +1 when the edge points up out of `v` and -1 otherwise. Returns that ancestor.
    fn walk(&mut self, edges: &[NetworkEdge], v: usize, target: usize, scaled: f64) -> usize {
        let mut at = v;
        while !self.in_subtree(at, target) {
            let p = self.parent_edge[at].expect("a node below the root has a parent edge");
            let sign = if edges[p].tail == at { 1.0 } else { -1.0 };
            self.cut[p] += sign * scaled;
            at = other(edges, p, at);
        }
        at
    }

    fn replace(&mut self, edges: &[NetworkEdge], leave: usize, enter: usize) {
        let out = edges[leave];
        let inn = edges[enter];
        for v in [out.tail, out.head] {
            let list = &mut self.adjacent[v];
            if let Some(p) = list.iter().position(|&x| x == leave) {
                list.remove(p);
            }
        }
        self.adjacent[inn.tail].push(enter);
        self.adjacent[inn.head].push(enter);
        let slot = self.slot_of[leave].expect("the leaving edge is a tree edge");
        self.chosen[slot] = enter;
        self.slot_of[enter] = Some(slot);
        self.slot_of[leave] = None;
    }

    /// Gives each node in the subtree of `start` a postorder number from `first` on, with `low` the least number below
    /// it. The subtree keeps its node set across an exchange, so its numbers come out in the same range.
    fn number(&mut self, edges: &[NetworkEdge], start: usize, first: usize) {
        self.cursor.clear();
        self.cursor.resize(self.adjacent.len(), 0);
        self.numbering.clear();
        self.numbering.push(start);
        let mut next = first;
        self.low[start] = next;
        while let Some(&v) = self.numbering.last() {
            if self.cursor[v] < self.adjacent[v].len() {
                let ei = self.adjacent[v][self.cursor[v]];
                self.cursor[v] += 1;
                if Some(ei) == self.parent_edge[v] {
                    continue;
                }
                let w = other(edges, ei, v);
                self.parent_edge[w] = Some(ei);
                self.low[w] = next;
                self.numbering.push(w);
            } else {
                self.lim[v] = next;
                next += 1;
                self.numbering.pop();
            }
        }
    }
}

/// The end of edge `ei` that is not `v`.
fn other(edges: &[NetworkEdge], ei: usize, v: usize) -> usize {
    let e = edges[ei];
    if e.tail == v { e.head } else { e.tail }
}
