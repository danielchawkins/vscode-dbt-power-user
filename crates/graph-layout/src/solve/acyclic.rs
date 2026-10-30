//! The directed-cycle check of `vpsc.ts` (`assertAcyclic`). Kahn's algorithm finds the variables that cannot be ordered;
//! walking back through their stuck predecessors must revisit one, and that closes the cycle named in the error.

use super::{NONE, SolveError, id};

/// Scratch for the cycle check, reused across calls.
#[derive(Debug, Default)]
pub(super) struct Acyclic {
    indegree: Vec<u32>,
    queue: Vec<u32>,
    /// Successors and predecessors in compressed rows: row `v` is `succ[succ_start[v]..succ_start[v + 1]]`.
    succ_start: Vec<usize>,
    succ: Vec<u32>,
    pred_start: Vec<usize>,
    pred: Vec<u32>,
    cursor: Vec<usize>,
    walk: Vec<u32>,
    /// The index of each variable in `walk`, `NONE` when not yet walked.
    position: Vec<u32>,
}

/// Fills the compressed row `start`/`items` for the given ends, keeping each row in separation order.
fn rows(
    n: usize,
    ends: impl Iterator<Item = (u32, u32)> + Clone,
    start: &mut Vec<usize>,
    items: &mut Vec<u32>,
    cursor: &mut Vec<usize>,
    key: fn((u32, u32)) -> (u32, u32),
) {
    start.clear();
    start.resize(n + 1, 0);
    for pair in ends.clone() {
        start[key(pair).0 as usize + 1] += 1;
    }
    for v in 0..n {
        start[v + 1] += start[v];
    }
    cursor.clear();
    cursor.extend_from_slice(&start[..n]);
    items.clear();
    items.resize(start[n], NONE);
    for pair in ends {
        let (v, w) = key(pair);
        items[cursor[v as usize]] = w;
        cursor[v as usize] += 1;
    }
}

impl Acyclic {
    /// Checks that the separations `from[e] -> to[e]` over `n` variables form a DAG.
    ///
    /// # Errors
    ///
    /// Returns [`SolveError::Cycle`] naming the variables of a directed cycle, in the order of its separations.
    pub(super) fn check(&mut self, n: usize, from: &[u32], to: &[u32]) -> Result<(), SolveError> {
        self.indegree.clear();
        self.indegree.resize(n, 0);
        for &t in to {
            self.indegree[t as usize] += 1;
        }
        let pairs = || from.iter().zip(to).map(|(&a, &b)| (a, b));
        rows(
            n,
            pairs(),
            &mut self.succ_start,
            &mut self.succ,
            &mut self.cursor,
            |(a, b)| (a, b),
        );
        rows(
            n,
            pairs(),
            &mut self.pred_start,
            &mut self.pred,
            &mut self.cursor,
            |(a, b)| (b, a),
        );
        self.queue.clear();
        self.queue
            .extend((0..n).filter(|&v| self.indegree[v] == 0).map(id));
        let mut i = 0;
        while i < self.queue.len() {
            let v = self.queue[i] as usize;
            for k in self.succ_start[v]..self.succ_start[v + 1] {
                let w = self.succ[k] as usize;
                self.indegree[w] -= 1;
                if self.indegree[w] == 0 {
                    self.queue.push(id(w));
                }
            }
            i += 1;
        }
        let Some(start) = (0..n).find(|&v| self.indegree[v] > 0) else {
            return Ok(());
        };
        // Every stuck variable has a stuck predecessor, so walking back must revisit one: that closes a cycle.
        self.walk.clear();
        self.position.clear();
        self.position.resize(n, NONE);
        let mut v = start;
        while self.position[v] == NONE {
            self.position[v] = id(self.walk.len());
            self.walk.push(id(v));
            let stuck = self.pred[self.pred_start[v]..self.pred_start[v + 1]]
                .iter()
                .find(|&&u| self.indegree[u as usize] > 0);
            let Some(&p) = stuck else {
                return Err(SolveError::Cycle {
                    variables: Vec::new(),
                });
            };
            v = p as usize;
        }
        let mut cycle = self.walk[self.position[v] as usize..].to_vec();
        cycle.reverse();
        Err(SolveError::Cycle { variables: cycle })
    }
}
