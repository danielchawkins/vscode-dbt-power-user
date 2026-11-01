//! Cycle breaking for ranking: the arcs that point backwards in the greedy node order of Eades, Lin and Smyth (Information
//! Processing Letters 47(6), 1993). A port of `packages/graph-layout/src/acyclic.ts`.

/// The buffers that cycle breaking reuses between calls: the renumbered arcs, the adjacency of the greedy order and its
/// state. Every buffer is cleared, not reallocated, on the next call, so a warm one allocates nothing.
#[derive(Debug, Default)]
pub(super) struct CycleScratch {
    /// Each endpoint with its position: arc `i` has positions `2i` (its source) and `2i + 1` (its target). Sorted by value
    /// and then position, so each run of equal values is one node.
    keys: Vec<(usize, usize)>,
    /// The first position of each node and the node's run number, sorted by first position.
    firsts: Vec<(usize, usize)>,
    dense_of_run: Vec<usize>,
    dense_of_pos: Vec<usize>,
    /// The arcs renumbered densely, in arc order.
    dense: Vec<(usize, usize)>,
    /// Out-arcs and in-arcs of each node (self-loops excluded), as compressed rows: the arcs of node `v` are
    /// `list[start[v]..start[v + 1]]`, in arc order.
    out_start: Vec<usize>,
    out_list: Vec<usize>,
    in_start: Vec<usize>,
    in_list: Vec<usize>,
    fill: Vec<usize>,
    out_degree: Vec<usize>,
    in_degree: Vec<usize>,
    alive: Vec<bool>,
    remaining: usize,
    front: Vec<usize>,
    back: Vec<usize>,
    position: Vec<usize>,
    reversed: Vec<usize>,
}

impl CycleScratch {
    /// The indices of the arcs that point backwards in a greedy node order, in input order. Each arc is a `(from, to)`
    /// pair of node numbers, of any values: they are renumbered by first appearance (source before target), as
    /// `acyclic.ts` numbers its names, so the result depends on the arcs and their order only. A self-loop is never
    /// reported.
    pub(super) fn reversed_arcs(&mut self, arcs: &[(usize, usize)]) -> &[usize] {
        let count = self.renumber(arcs);
        self.greedy_order(count);
        self.reversed.clear();
        for (i, &(from, to)) in self.dense.iter().enumerate() {
            if from != to && self.position[from] > self.position[to] {
                self.reversed.push(i);
            }
        }
        &self.reversed
    }

    /// Fills `dense` with the arcs renumbered by first appearance, and returns the number of nodes.
    fn renumber(&mut self, arcs: &[(usize, usize)]) -> usize {
        self.keys.clear();
        for (i, &(from, to)) in arcs.iter().enumerate() {
            self.keys.push((from, 2 * i));
            self.keys.push((to, 2 * i + 1));
        }
        self.keys.sort_unstable();
        self.firsts.clear();
        let mut run = 0;
        for (k, &(value, pos)) in self.keys.iter().enumerate() {
            if k > 0 && value != self.keys[k - 1].0 {
                run += 1;
            }
            if k == 0 || value != self.keys[k - 1].0 {
                self.firsts.push((pos, run));
            }
        }
        self.firsts.sort_unstable();
        self.dense_of_run.clear();
        self.dense_of_run.resize(self.firsts.len(), 0);
        for (dense, &(_, run)) in self.firsts.iter().enumerate() {
            self.dense_of_run[run] = dense;
        }
        self.dense_of_pos.clear();
        self.dense_of_pos.resize(self.keys.len(), 0);
        let mut run = 0;
        for (k, &(value, pos)) in self.keys.iter().enumerate() {
            if k > 0 && value != self.keys[k - 1].0 {
                run += 1;
            }
            self.dense_of_pos[pos] = self.dense_of_run[run];
        }
        self.dense.clear();
        for i in 0..arcs.len() {
            self.dense
                .push((self.dense_of_pos[2 * i], self.dense_of_pos[2 * i + 1]));
        }
        self.firsts.len()
    }

    /// Sets `position` to the position of each node in the greedy order: sinks move to the back, sources to the front,
    /// and otherwise the node with the largest out-degree minus in-degree goes to the front. Ties go to the lowest
    /// index, so the order is deterministic.
    fn greedy_order(&mut self, count: usize) {
        self.build_adjacency(count);
        self.front.clear();
        self.back.clear();
        self.remove_sinks_and_sources();
        while self.remaining > 0 {
            let v = self.best_remaining();
            self.front.push(v);
            self.remove(v);
            self.remove_sinks_and_sources();
        }
        // The order is the front, then the back reversed.
        self.position.clear();
        self.position.resize(count, 0);
        for (p, &v) in self.front.iter().enumerate() {
            self.position[v] = p;
        }
        let front = self.front.len();
        let last = self.back.len().saturating_sub(1);
        for (j, &v) in self.back.iter().enumerate() {
            self.position[v] = front + (last - j);
        }
    }

    /// Sets up the adjacency rows, the degrees and the live set for a greedy order of `count` nodes.
    fn build_adjacency(&mut self, count: usize) {
        self.out_degree.clear();
        self.out_degree.resize(count, 0);
        self.in_degree.clear();
        self.in_degree.resize(count, 0);
        for &(from, to) in &self.dense {
            if from != to {
                self.out_degree[from] += 1;
                self.in_degree[to] += 1;
            }
        }
        self.out_start.clear();
        self.in_start.clear();
        let (mut out_end, mut in_end) = (0, 0);
        for v in 0..count {
            self.out_start.push(out_end);
            self.in_start.push(in_end);
            out_end += self.out_degree[v];
            in_end += self.in_degree[v];
        }
        self.out_start.push(out_end);
        self.in_start.push(in_end);
        self.out_list.clear();
        self.out_list.resize(out_end, 0);
        self.in_list.clear();
        self.in_list.resize(in_end, 0);
        self.fill.clear();
        self.fill.extend_from_slice(&self.out_start[..count]);
        for (a, &(from, to)) in self.dense.iter().enumerate() {
            if from != to {
                self.out_list[self.fill[from]] = a;
                self.fill[from] += 1;
            }
        }
        self.fill.clear();
        self.fill.extend_from_slice(&self.in_start[..count]);
        for (a, &(from, to)) in self.dense.iter().enumerate() {
            if from != to {
                self.in_list[self.fill[to]] = a;
                self.fill[to] += 1;
            }
        }
        self.alive.clear();
        self.alive.resize(count, true);
        self.remaining = count;
    }

    /// Takes `v` out of the graph. Each arc lowers the degree of its far end once, so no degree goes below zero.
    fn remove(&mut self, v: usize) {
        self.alive[v] = false;
        self.remaining -= 1;
        for k in self.out_start[v]..self.out_start[v + 1] {
            let a = self.out_list[k];
            self.in_degree[self.dense[a].1] -= 1;
        }
        for k in self.in_start[v]..self.in_start[v + 1] {
            let a = self.in_list[k];
            self.out_degree[self.dense[a].0] -= 1;
        }
    }

    /// Moves every sink to the back and every source to the front, repeating until neither exists. The scan goes in
    /// index order and a removal is seen by the rest of the same scan.
    fn remove_sinks_and_sources(&mut self) {
        loop {
            let mut found = false;
            for v in 0..self.alive.len() {
                if !self.alive[v] {
                    continue;
                }
                if self.out_degree[v] == 0 {
                    self.back.push(v);
                } else if self.in_degree[v] == 0 {
                    self.front.push(v);
                } else {
                    continue;
                }
                self.remove(v);
                found = true;
            }
            if !found {
                return;
            }
        }
    }

    /// The live node with the largest out-degree minus in-degree, the lowest index on a tie. The comparison adds the
    /// degrees across so that it stays in `usize`: `out(v) - in(v) > out(b) - in(b)` is `out(v) + in(b) > out(b) + in(v)`.
    fn best_remaining(&self) -> usize {
        let mut best: Option<usize> = None;
        for v in 0..self.alive.len() {
            if !self.alive[v] {
                continue;
            }
            best = match best {
                Some(b)
                    if self.out_degree[v] + self.in_degree[b]
                        <= self.out_degree[b] + self.in_degree[v] =>
                {
                    Some(b)
                }
                _ => Some(v),
            };
        }
        best.unwrap_or(0)
    }
}
