//! The active separations as a forest over the variables (`vpscForest.ts`). Each variable's links sit in a fixed slot of
//! `adj`, sized by its degree in the whole separation graph, so linking and unlinking never allocate. A slot keeps its
//! entries in link order, because the traversals visit them in that order and the sums depend on it.

use super::{NONE, id};

/// The separations as adjacency slots over the variables.
#[derive(Debug, Default)]
pub(super) struct Tree {
    from: Vec<u32>,
    to: Vec<u32>,
    /// Where each variable's slot starts in `adj`; the slot holds the variable's separations, in link order.
    slot_start: Vec<usize>,
    /// How many separations of the slot are linked.
    links: Vec<usize>,
    adj: Vec<u32>,
}

impl Tree {
    /// The linked separations at `v`, in link order.
    fn slot(&self, v: usize) -> &[u32] {
        let start = self.slot_start[v];
        &self.adj[start..start + self.links[v]]
    }

    /// The end of separation `e` that is not `v`.
    pub(super) fn other(&self, e: u32, v: u32) -> u32 {
        let from = self.from[e as usize];
        if from == v { self.to[e as usize] } else { from }
    }

    /// Breadth-first traversal of the component of `root`, rooted there, written into `queue` from index `start`. Its
    /// members are marked in `seen`, and each member other than the root gets its parent separation in `parent_edge`.
    /// Returns the index after the last member written.
    pub(super) fn traverse(
        &self,
        root: u32,
        seen: &mut [bool],
        parent_edge: &mut [u32],
        queue: &mut [u32],
        start: usize,
    ) -> usize {
        seen[root as usize] = true;
        queue[start] = root;
        let mut end = start + 1;
        let mut i = start;
        while i < end {
            let v = queue[i];
            for &e in self.slot(v as usize) {
                let u = self.other(e, v);
                if !seen[u as usize] {
                    seen[u as usize] = true;
                    parent_edge[u as usize] = e;
                    queue[end] = u;
                    end += 1;
                }
            }
            i += 1;
        }
        end
    }
}

/// The forest: its adjacency, plus the traversal state that the solver reads and reuses.
#[derive(Debug, Default)]
pub(super) struct Forest {
    pub(super) tree: Tree,
    /// Bumped by every link and unlink, so a cached spanning order can be checked against the forest it was made from.
    version: u64,
    /// The `(version, first)` the spanning order in `order` and `parent_edge` was computed for.
    cached: Option<(u64, u32)>,
    /// Breadth-first order over the whole forest: components are searched from `first`, each rooted at its first
    /// variable. A parent comes before its children.
    order: Vec<u32>,
    /// The separation each variable was reached by in `order`, `NONE` at a root.
    parent_edge: Vec<u32>,
    seen: Vec<bool>,
    path_seen: Vec<bool>,
    path_via: Vec<u32>,
    path_queue: Vec<u32>,
}

impl Forest {
    /// Sizes the forest for `n` variables and the given separations, with none linked.
    pub(super) fn reset(&mut self, n: usize, from: &[u32], to: &[u32]) {
        let tree = &mut self.tree;
        tree.from.clear();
        tree.from.extend_from_slice(from);
        tree.to.clear();
        tree.to.extend_from_slice(to);
        // Counts at `v + 1`, then a running sum: `slot_start[v]` is where the slot of `v` starts.
        tree.slot_start.clear();
        tree.slot_start.resize(n + 1, 0);
        for (&a, &b) in from.iter().zip(to) {
            tree.slot_start[a as usize + 1] += 1;
            tree.slot_start[b as usize + 1] += 1;
        }
        let mut total = 0;
        for start in &mut tree.slot_start {
            total += *start;
            *start = total;
        }
        tree.adj.clear();
        tree.adj.resize(total, NONE);
        tree.links.clear();
        tree.links.resize(n, 0);
        self.version += 1;
        self.cached = None;
        self.order.clear();
        self.order.resize(n, 0);
        self.parent_edge.clear();
        self.parent_edge.resize(n, NONE);
        self.seen.clear();
        self.seen.resize(n, false);
        self.path_seen.clear();
        self.path_seen.resize(n, false);
        self.path_via.clear();
        self.path_via.resize(n, NONE);
        self.path_queue.clear();
    }

    /// Makes separation `e` part of the forest.
    pub(super) fn link(&mut self, e: u32) {
        let tree = &mut self.tree;
        for v in [tree.from[e as usize], tree.to[e as usize]] {
            let v = v as usize;
            tree.adj[tree.slot_start[v] + tree.links[v]] = e;
            tree.links[v] += 1;
        }
        self.version += 1;
    }

    /// Removes separation `e` from the forest, keeping the order of the others.
    pub(super) fn unlink(&mut self, e: u32) {
        let tree = &mut self.tree;
        for v in [tree.from[e as usize], tree.to[e as usize]] {
            let v = v as usize;
            let start = tree.slot_start[v];
            let len = tree.links[v];
            if let Some(at) = tree.adj[start..start + len].iter().position(|&x| x == e) {
                tree.adj
                    .copy_within(start + at + 1..start + len, start + at);
                tree.links[v] -= 1;
            }
        }
        self.version += 1;
    }

    /// Makes sure `order` and `parent_edge` are the spanning order rooted from `first`. The result is cached until the
    /// forest changes.
    pub(super) fn ensure_order(&mut self, first: u32) {
        if self.cached == Some((self.version, first)) {
            return;
        }
        self.seen.fill(false);
        self.parent_edge.fill(NONE);
        let n = self.order.len();
        let mut end = 0;
        for k in 0..n {
            let root = (first as usize + k) % n;
            if !self.seen[root] {
                end = self.tree.traverse(
                    id(root),
                    &mut self.seen,
                    &mut self.parent_edge,
                    &mut self.order,
                    end,
                );
            }
        }
        self.cached = Some((self.version, first));
    }

    /// The breadth-first order of the last [`Forest::ensure_order`].
    pub(super) fn order(&self) -> &[u32] {
        &self.order
    }

    /// The parent separation of each variable in the last [`Forest::ensure_order`], `NONE` at a root.
    pub(super) fn parents(&self) -> &[u32] {
        &self.parent_edge
    }

    /// Writes the separations on the forest path from `a` to `b` into `out`, from `b` back towards `a`. Returns false
    /// when `b` is not connected to `a`.
    pub(super) fn path(&mut self, start: u32, goal: u32, out: &mut Vec<u32>) -> bool {
        out.clear();
        self.path_seen.fill(false);
        self.path_queue.clear();
        self.path_seen[start as usize] = true;
        self.path_queue.push(start);
        let mut at = 0;
        while at < self.path_queue.len() {
            let v = self.path_queue[at];
            for &e in self.tree.slot(v as usize) {
                let u = self.tree.other(e, v);
                if !self.path_seen[u as usize] {
                    self.path_seen[u as usize] = true;
                    self.path_via[u as usize] = e;
                    self.path_queue.push(u);
                }
            }
            at += 1;
        }
        if !self.path_seen[goal as usize] {
            return false;
        }
        let mut v = goal;
        while v != start {
            let e = self.path_via[v as usize];
            out.push(e);
            v = self.tree.other(e, v);
        }
        true
    }
}
