//! The spanning tree that network simplex pivots on, and the feasible tight tree that starts it. Ports
//! `packages/graph-layout/src/rank/feasibleTree.ts` and `spanningTree.ts`.

use super::RankError;
use super::network::{NetworkEdge, slack};

/// Builds a feasible tight spanning tree, as in Gansner, Koutsofios, North and Vo (1993). Starting from node 0, the
/// tree takes every edge with zero slack that reaches a new node. When none is left, the smallest slack on an edge
/// leaving the tree is closed by shifting the whole tree; that keeps every other edge feasible. `ranks` must be
/// feasible on entry and is updated in place. Returns the indices of the tree edges, one per node but the first.
pub(super) fn feasible_tree(
    count: usize,
    edges: &[NetworkEdge],
    ranks: &mut [f64],
) -> Result<Vec<usize>, RankError> {
    let mut incident = vec![Vec::new(); count];
    for (ei, e) in edges.iter().enumerate() {
        incident[e.tail].push(ei);
        incident[e.head].push(ei);
    }
    let mut build = TreeBuild {
        edges,
        incident: &incident,
        ranks,
        in_tree: (0..count).map(|v| v == 0).collect(),
        members: vec![0],
        tree_edges: Vec::new(),
    };
    while build.members.len() < count {
        build.grow_tight();
        if build.members.len() < count {
            build.close_gap()?;
        }
    }
    Ok(build.tree_edges)
}

/// The state of the feasible-tree build: the tree so far and the ranks, which the closing shifts move in place.
struct TreeBuild<'a> {
    edges: &'a [NetworkEdge],
    incident: &'a [Vec<usize>],
    ranks: &'a mut [f64],
    in_tree: Vec<bool>,
    members: Vec<usize>,
    tree_edges: Vec<usize>,
}

impl TreeBuild<'_> {
    /// Adds, by depth-first search, every node reachable from the tree over zero-slack edges.
    fn grow_tight(&mut self) {
        let mut stack = self.members.clone();
        while let Some(x) = stack.pop() {
            for &ei in &self.incident[x] {
                let e = self.edges[ei];
                let y = if e.tail == x { e.head } else { e.tail };
                if self.in_tree[y] || slack(self.ranks, e) != 0.0 {
                    continue;
                }
                self.in_tree[y] = true;
                self.members.push(y);
                self.tree_edges.push(ei);
                stack.push(y);
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
        for &v in &self.members {
            self.ranks[v] += shift;
        }
        Ok(())
    }
}

/// The spanning tree of a network: a postorder range per node (`low` to `lim`), so that `in_subtree` answers in
/// constant time, and a cut value per tree edge. Gansner et al. (1993, section 2.4) update the cut values only along
/// the cycle that an exchange closes, which `exchange` does.
pub(super) struct SpanningTree<'a> {
    edges: &'a [NetworkEdge],
    adjacent: Vec<Vec<usize>>,
    parent_edge: Vec<Option<usize>>,
    low: Vec<usize>,
    lim: Vec<usize>,
    cut: Vec<f64>,
    tree_edges: Vec<usize>,
    slot_of: Vec<Option<usize>>,
}

impl<'a> SpanningTree<'a> {
    /// `tree_edges` must form a spanning tree of the `count` nodes. The root is node 0.
    pub(super) fn new(count: usize, edges: &'a [NetworkEdge], tree_edges: &[usize]) -> Self {
        let mut tree = Self {
            edges,
            adjacent: vec![Vec::new(); count],
            parent_edge: vec![None; count],
            low: vec![0; count],
            lim: vec![0; count],
            cut: vec![0.0; edges.len()],
            tree_edges: tree_edges.to_vec(),
            slot_of: vec![None; edges.len()],
        };
        for (slot, &ei) in tree_edges.iter().enumerate() {
            tree.slot_of[ei] = Some(slot);
            tree.adjacent[edges[ei].tail].push(ei);
            tree.adjacent[edges[ei].head].push(ei);
        }
        tree.number(0, 0);
        for &f in tree_edges {
            tree.cut[f] = tree.cut_of(f);
        }
        tree
    }

    /// The tree edges, in a fixed slot order that a search can cycle through.
    pub(super) fn tree_edges(&self) -> &[usize] {
        &self.tree_edges
    }

    pub(super) fn is_tree(&self, ei: usize) -> bool {
        self.slot_of[ei].is_some()
    }

    /// The cut value of a tree edge: negative means moving the tail-side component's end of it lowers the length.
    pub(super) fn cut(&self, ei: usize) -> f64 {
        self.cut[ei]
    }

    /// The endpoint of tree edge `ei` that lies further from the root.
    pub(super) fn child_of(&self, ei: usize) -> usize {
        let e = self.edges[ei];
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

    /// Swaps tree edge `leave` for the non-tree edge `enter`, whose ends lie on the two sides `leave` separates. The
    /// cut values on the cycle that `enter` closes are updated first, while the old numbering still holds.
    pub(super) fn exchange(&mut self, leave: usize, enter: usize) {
        let cut_leave = self.cut[leave];
        let en = self.edges[enter];
        let lca = self.walk(en.tail, en.head, cut_leave);
        self.walk(en.head, en.tail, -cut_leave);
        self.cut[enter] = -cut_leave;
        self.cut[leave] = 0.0;
        self.replace(leave, enter);
        self.number(lca, self.low[lca]);
    }

    /// The cut of a tree edge, computed from scratch: the sum over every edge that crosses the cut it makes.
    fn cut_of(&self, f: usize) -> f64 {
        let child = self.child_of(f);
        let tail_is_child = child == self.edges[f].tail;
        let mut sum = 0.0;
        for x in self.edges {
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
    fn walk(&mut self, v: usize, target: usize, scaled: f64) -> usize {
        let mut at = v;
        while !self.in_subtree(at, target) {
            let p = self.parent_edge[at].expect("a node below the root has a parent edge");
            let sign = if self.edges[p].tail == at { 1.0 } else { -1.0 };
            self.cut[p] += sign * scaled;
            at = self.other(p, at);
        }
        at
    }

    fn replace(&mut self, leave: usize, enter: usize) {
        let out = self.edges[leave];
        let inn = self.edges[enter];
        for v in [out.tail, out.head] {
            let list = &mut self.adjacent[v];
            if let Some(p) = list.iter().position(|&x| x == leave) {
                list.remove(p);
            }
        }
        self.adjacent[inn.tail].push(enter);
        self.adjacent[inn.head].push(enter);
        let slot = self.slot_of[leave].expect("the leaving edge is a tree edge");
        self.tree_edges[slot] = enter;
        self.slot_of[enter] = Some(slot);
        self.slot_of[leave] = None;
    }

    fn other(&self, ei: usize, v: usize) -> usize {
        let e = self.edges[ei];
        if e.tail == v { e.head } else { e.tail }
    }

    /// Gives each node in the subtree of `start` a postorder number from `first` on, with `low` the least number below
    /// it. The subtree keeps its node set across an exchange, so its numbers come out in the same range.
    fn number(&mut self, start: usize, first: usize) {
        let mut cursor = vec![0usize; self.adjacent.len()];
        let mut stack = vec![start];
        let mut next = first;
        self.low[start] = next;
        while let Some(&v) = stack.last() {
            if cursor[v] < self.adjacent[v].len() {
                let ei = self.adjacent[v][cursor[v]];
                cursor[v] += 1;
                if Some(ei) == self.parent_edge[v] {
                    continue;
                }
                let w = self.other(ei, v);
                self.parent_edge[w] = Some(ei);
                self.low[w] = next;
                stack.push(w);
            } else {
                self.lim[v] = next;
                next += 1;
                stack.pop();
            }
        }
    }
}
