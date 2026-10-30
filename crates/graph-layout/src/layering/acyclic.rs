//! Cycle breaking for ranking: the arcs that point backwards in the greedy node order of Eades, Lin and Smyth (Information
//! Processing Letters 47(6), 1993). A port of `packages/graph-layout/src/acyclic.ts`.

use std::collections::BTreeMap;

/// The indices of the arcs that point backwards in a greedy node order, in input order. Each arc is a `(from, to)` pair
/// of node numbers, of any values: they are renumbered by first appearance (source before target), as `acyclic.ts`
/// numbers its names, so the result depends on the arcs and their order only. A self-loop is never reported.
pub(super) fn reversed_arcs(arcs: &[(usize, usize)]) -> Vec<usize> {
    let mut names: BTreeMap<usize, usize> = BTreeMap::new();
    let mut name = |node: usize| {
        let next = names.len();
        *names.entry(node).or_insert(next)
    };
    let dense: Vec<(usize, usize)> = arcs
        .iter()
        .map(|&(from, to)| {
            let f = name(from);
            (f, name(to))
        })
        .collect();
    let position = greedy_order(names.len(), &dense);
    dense
        .iter()
        .enumerate()
        .filter(|&(_, &(from, to))| from != to && position[from] > position[to])
        .map(|(i, _)| i)
        .collect()
}

/// The arcs of a graph of `count` nodes, as the position of each node in the greedy order: sinks move to the back,
/// sources to the front, and otherwise the node with the largest out-degree minus in-degree goes to the front. Ties go
/// to the lowest index, so the order is deterministic.
fn greedy_order(count: usize, arcs: &[(usize, usize)]) -> Vec<usize> {
    let mut state = Greedy::new(count, arcs);
    state.remove_sinks_and_sources();
    while state.remaining > 0 {
        let v = state.best_remaining();
        state.front.push(v);
        state.remove(v);
        state.remove_sinks_and_sources();
    }
    let mut sequence = state.front;
    sequence.extend(state.back.iter().rev());
    let mut position = vec![0; count];
    for (p, v) in sequence.into_iter().enumerate() {
        position[v] = p;
    }
    position
}

/// The working state of the greedy order: the arcs at each node, the degrees of the nodes still standing, and the two
/// ends of the order built so far.
struct Greedy<'a> {
    arcs: &'a [(usize, usize)],
    out_arcs: Vec<Vec<usize>>,
    in_arcs: Vec<Vec<usize>>,
    out_degree: Vec<usize>,
    in_degree: Vec<usize>,
    alive: Vec<bool>,
    remaining: usize,
    front: Vec<usize>,
    back: Vec<usize>,
}

impl<'a> Greedy<'a> {
    fn new(count: usize, arcs: &'a [(usize, usize)]) -> Self {
        let mut out_arcs = vec![Vec::new(); count];
        let mut in_arcs = vec![Vec::new(); count];
        for (i, &(from, to)) in arcs.iter().enumerate() {
            if from != to {
                out_arcs[from].push(i);
                in_arcs[to].push(i);
            }
        }
        Self {
            arcs,
            out_degree: out_arcs.iter().map(Vec::len).collect(),
            in_degree: in_arcs.iter().map(Vec::len).collect(),
            out_arcs,
            in_arcs,
            alive: vec![true; count],
            remaining: count,
            front: Vec::new(),
            back: Vec::new(),
        }
    }

    /// Takes `v` out of the graph. Each arc lowers the degree of its far end once, so no degree goes below zero.
    fn remove(&mut self, v: usize) {
        self.alive[v] = false;
        self.remaining -= 1;
        for &i in &self.out_arcs[v] {
            self.in_degree[self.arcs[i].1] -= 1;
        }
        for &i in &self.in_arcs[v] {
            self.out_degree[self.arcs[i].0] -= 1;
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
