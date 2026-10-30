//! The blocks of the variable-merging method (`vpscBlocks.ts`). Variable `v` sits at its block's position plus its offset
//! `off[v]`. The active separations are tight and form a forest; each component of the forest is a block. The block
//! state is struct-of-arrays, indexed by block id, with each block's members in a linked list.

use std::mem::take;

use super::forest::Forest;
use super::{NONE, SolveError, id, reserve_to};

/// The solver state: the input copied in, the block arrays, and the scratch the steps reuse.
#[derive(Debug, Default)]
pub(super) struct Blocks {
    pub(super) x0: Vec<f64>,
    pub(super) weight: Vec<f64>,
    /// The kept separations: the ends and gap of each, in input order.
    pub(super) from: Vec<u32>,
    pub(super) to: Vec<u32>,
    pub(super) gap: Vec<f64>,
    /// Offset of each variable from its block's position.
    pub(super) off: Vec<f64>,
    /// Block id of each variable.
    pub(super) block_of: Vec<u32>,
    /// Position of each block, by block id. Ids past the block count are unused.
    pub(super) pos: Vec<f64>,
    /// Whether each separation is active: tight, and joining two variables of one block.
    pub(super) active: Vec<bool>,
    pub(super) forest: Forest,
    /// Per block id: its smallest member, the root `multipliers` reaches it from.
    least: Vec<u32>,
    /// Per block id: the sum of its members' weights.
    block_weight: Vec<f64>,
    /// Per block id: the sum of weight * (x0 - offset) over its members.
    weighted: Vec<f64>,
    /// Per block id: the number of members.
    size: Vec<usize>,
    /// Per block id: the first and last member of its list.
    head: Vec<u32>,
    tail: Vec<u32>,
    /// Per variable: the next member of its block's list, `NONE` at the end.
    next: Vec<u32>,
    /// The number of blocks after the last rebuild.
    block_count: usize,
    /// The inactive separations, ascending: the only ones the violation scan looks at. The first `candidate_count`
    /// entries are valid.
    candidates: Vec<u32>,
    candidate_count: usize,
    /// Scratch for `negative_in`: the walked variables, marks, parent separations, and the offset sums.
    walk_seen: Vec<bool>,
    walk_parent: Vec<u32>,
    walk_queue: Vec<u32>,
    walk_end: usize,
    walk_sub: Vec<f64>,
    /// Scratch: the multipliers of the last `multipliers` call, and its weighted residuals.
    pub(super) lam: Vec<f64>,
    sub: Vec<f64>,
    /// Scratch: the separations `negative_in` found, and the ends to re-check after a split.
    pub(super) negative: Vec<u32>,
    pub(super) dirty: Vec<u32>,
    /// Scratch: the separations on a forest path that a within-block violation can release.
    losing: Vec<u32>,
}

/// Coordinate of variable `v` given the position of its block.
fn value_of(pos: &[f64], block_of: &[u32], off: &[f64], v: usize) -> f64 {
    pos[block_of[v] as usize] + off[v]
}

impl Blocks {
    /// Reserves the lists that `reset` does not size: `negative` (at most one entry per separation), `dirty` (two ends
    /// per negative separation, and the two ends of the first violation), `losing` (a forest path, at most one entry
    /// per variable), and the forest's path queue.
    pub(super) fn reserve(&mut self, n: usize, kept: usize) {
        reserve_to(&mut self.negative, kept);
        reserve_to(&mut self.dirty, 2 * (kept + 1));
        reserve_to(&mut self.losing, n);
        self.forest.reserve(n);
    }

    /// Sizes every array for the copied input and makes each variable its own block.
    pub(super) fn reset(&mut self) {
        let n = self.x0.len();
        let m = self.gap.len();
        self.forest.reset(n, &self.from, &self.to);
        self.off.clear();
        self.off.resize(n, 0.0);
        self.block_of.clear();
        self.block_of.resize(n, 0);
        self.pos.clear();
        self.pos.resize(n, 0.0);
        self.active.clear();
        self.active.resize(m, false);
        self.candidates.clear();
        self.candidates.extend((0..m).map(id));
        self.candidate_count = m;
        self.least.clear();
        self.least.resize(n, 0);
        self.block_weight.clear();
        self.block_weight.resize(n, 0.0);
        self.weighted.clear();
        self.weighted.resize(n, 0.0);
        self.size.clear();
        self.size.resize(n, 0);
        self.head.clear();
        self.head.resize(n, NONE);
        self.tail.clear();
        self.tail.resize(n, NONE);
        self.next.clear();
        self.next.resize(n, NONE);
        self.walk_seen.clear();
        self.walk_seen.resize(n, false);
        self.walk_parent.clear();
        self.walk_parent.resize(n, NONE);
        self.walk_queue.clear();
        self.walk_queue.resize(n, 0);
        self.walk_sub.clear();
        self.walk_sub.resize(n, 0.0);
        self.lam.clear();
        self.lam.resize(m, 0.0);
        self.sub.clear();
        self.sub.resize(n, 0.0);
        self.rebuild();
    }

    /// Current coordinate of variable `v`.
    pub(super) fn value(&self, v: usize) -> f64 {
        value_of(&self.pos, &self.block_of, &self.off, v)
    }

    /// The inactive separation with the largest violation: the smallest slack below `-tolerance`, the lowest index on a
    /// tie. It is taken among those whose ends share a block when `within` is set, and among the others otherwise.
    pub(super) fn most_violated(&self, within: bool, tolerance: f64) -> Option<u32> {
        let mut worst = None;
        let mut worst_slack = -tolerance;
        for &e in &self.candidates[..self.candidate_count] {
            let ei = e as usize;
            let f = self.from[ei] as usize;
            let t = self.to[ei] as usize;
            let bf = self.block_of[f];
            let bt = self.block_of[t];
            if (bf == bt) != within {
                continue;
            }
            let slack = self.pos[bt as usize] + self.off[t]
                - (self.pos[bf as usize] + self.off[f])
                - self.gap[ei];
            if slack < worst_slack {
                worst = Some(e);
                worst_slack = slack;
            }
        }
        worst
    }

    /// Joins the blocks of separation `e`, whose ends lie in two different blocks, so that `e` becomes tight. The
    /// smaller block is shifted rigidly and the two merge into one block.
    pub(super) fn join(&mut self, e: u32) {
        let ei = e as usize;
        let f = self.from[ei] as usize;
        let t = self.to[ei] as usize;
        let bf = self.block_of[f] as usize;
        let bt = self.block_of[t] as usize;
        let shift = self.gap[ei] - (self.off[t] - self.off[f]);
        let to_moves = self.size[bt] <= self.size[bf];
        let (keep, mv) = if to_moves { (bf, bt) } else { (bt, bf) };
        self.shift_block(mv, if to_moves { shift } else { -shift });
        let mut v = self.head[mv];
        while v != NONE {
            self.block_of[v as usize] = id(keep);
            v = self.next[v as usize];
        }
        let kept_tail = self.tail[keep] as usize;
        self.next[kept_tail] = self.head[mv];
        self.tail[keep] = self.tail[mv];
        self.size[keep] += self.size[mv];
        self.least[keep] = self.least[keep].min(self.least[mv]);
        self.block_weight[keep] += self.block_weight[mv];
        self.weighted[keep] += self.weighted[mv];
        self.pos[keep] = self.weighted[keep] / self.block_weight[keep];
        self.size[mv] = 0;
        self.head[mv] = NONE;
        self.tail[mv] = NONE;
        self.active[ei] = true;
        self.remove_candidate(e);
        self.forest.link(e);
    }

    /// Resolves separation `e`, violated inside one block. Raising `e`'s multiplier from zero circulates along the
    /// forest path between its ends: the path separations pointing away from the first end lose multiplier. The first
    /// of those to reach zero is released, and then `e` is joined. If that multiplier is already negative, it is split
    /// off alone.
    pub(super) fn resolve_within(&mut self, e: u32) -> Result<(), SolveError> {
        let f = self.from[e as usize];
        let t = self.to[e as usize];
        self.multipliers();
        let mut losing = take(&mut self.losing);
        let found = self.forest.path(f, t, &mut losing);
        self.forest.ensure_order(f);
        {
            let parents = self.forest.parents();
            let to = &self.to;
            losing.retain(|&p| parents[to[p as usize] as usize] == p);
        }
        if !found || losing.is_empty() {
            self.losing = losing;
            return Err(SolveError::Unsatisfiable { separation: e });
        }
        let mut first = losing[0];
        for &b in &losing[1..] {
            if self.lam[b as usize] < self.lam[first as usize] {
                first = b;
            }
        }
        self.losing = losing;
        let multiplier = self.lam[first as usize];
        self.split(&[first]);
        if multiplier >= 0.0 {
            self.join(e);
        }
        Ok(())
    }

    /// Fills `lam` with the Lagrange multiplier of each separation: the weighted residual of the variables on its `to`
    /// side. Inactive separations get zero.
    pub(super) fn multipliers(&mut self) {
        let Self {
            forest,
            x0,
            weight,
            off,
            block_of,
            pos,
            to,
            sub,
            lam,
            ..
        } = self;
        forest.ensure_order(0);
        let order = forest.order();
        let parents = forest.parents();
        sub.clear();
        sub.extend(
            x0.iter()
                .zip(weight.iter())
                .enumerate()
                .map(|(v, (&x0v, &wv))| wv * (value_of(pos, block_of, off, v) - x0v)),
        );
        lam.clear();
        lam.resize(to.len(), 0.0);
        for &v in order.iter().rev() {
            let vi = v as usize;
            let e = parents[vi];
            if e == NONE {
                continue;
            }
            let p = forest.tree.other(e, v) as usize;
            let s = sub[vi];
            lam[e as usize] = if to[e as usize] == v { s } else { -s };
            sub[p] += s;
        }
    }

    /// The active separations with a multiplier below `-tolerance`, in ascending order, found by looking only in the
    /// blocks of `dirty`. Each such block is walked from its smallest member, the root `multipliers` reaches it from,
    /// and summed in the same order, so every multiplier equals the one `multipliers` gives. Results go to `negative`.
    pub(super) fn negative_in(&mut self, dirty: &[u32], tolerance: f64) {
        self.negative.clear();
        self.walk_end = 0;
        for &v in dirty {
            let root = self.least[self.block_of[v as usize] as usize];
            if self.walk_seen[root as usize] {
                continue;
            }
            self.walk_block(root, tolerance);
        }
        for &v in &self.walk_queue[..self.walk_end] {
            self.walk_seen[v as usize] = false;
        }
        self.negative.sort_unstable();
    }

    /// Walks the block rooted at `root` as `multipliers` does. Its variables are appended to the walk queue and marked
    /// until the caller clears them. Its separations with a multiplier below `-tolerance` go to `negative`.
    fn walk_block(&mut self, root: u32, tolerance: f64) {
        let start = self.walk_end;
        self.walk_parent[root as usize] = NONE;
        let end = self.forest.tree.traverse(
            root,
            &mut self.walk_seen,
            &mut self.walk_parent,
            &mut self.walk_queue,
            start,
        );
        self.walk_end = end;
        for i in start..end {
            let u = self.walk_queue[i] as usize;
            let residual = self.weight[u] * (self.value(u) - self.x0[u]);
            self.walk_sub[u] = residual;
        }
        for i in (start..end).rev() {
            let u = self.walk_queue[i];
            let e = self.walk_parent[u as usize];
            if e == NONE {
                continue;
            }
            let p = self.forest.tree.other(e, u) as usize;
            let s = self.walk_sub[u as usize];
            let lam = if self.to[e as usize] == u { s } else { -s };
            if lam < -tolerance {
                self.negative.push(e);
            }
            self.walk_sub[p] += s;
        }
    }

    /// Deactivates the given active separations, splitting their blocks, and recomputes the positions.
    pub(super) fn split(&mut self, edges: &[u32]) {
        for &e in edges {
            self.active[e as usize] = false;
            self.forest.unlink(e);
        }
        self.refresh_candidates();
        self.rebuild();
    }

    /// Drops separation `e`, which has just become active, from the sorted candidates.
    fn remove_candidate(&mut self, e: u32) {
        let mut lo = 0;
        let mut hi = self.candidate_count;
        while lo < hi {
            let mid = usize::midpoint(lo, hi);
            if self.candidates[mid] < e {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        self.candidates
            .copy_within(lo + 1..self.candidate_count, lo);
        self.candidate_count -= 1;
    }

    /// Lists the inactive separations again, ascending, after some have been deactivated.
    fn refresh_candidates(&mut self) {
        let mut k = 0;
        for (e, &active) in self.active.iter().enumerate() {
            if !active {
                self.candidates[k] = id(e);
                k += 1;
            }
        }
        self.candidate_count = k;
    }

    /// Recomputes the blocks from the active forest. Offsets are kept, since every kept separation still holds.
    fn rebuild(&mut self) {
        let Self {
            forest,
            x0,
            weight,
            off,
            block_of,
            pos,
            least,
            block_weight,
            weighted,
            size,
            head,
            tail,
            next,
            block_count,
            ..
        } = self;
        forest.ensure_order(0);
        let order = forest.order();
        let parents = forest.parents();
        let mut count = 0;
        for &v in order {
            let vi = v as usize;
            let e = parents[vi];
            if e == NONE {
                block_of[vi] = id(count);
                let b = count;
                least[b] = v;
                block_weight[b] = 0.0;
                weighted[b] = 0.0;
                size[b] = 0;
                head[b] = NONE;
                tail[b] = NONE;
                count += 1;
            } else {
                block_of[vi] = block_of[forest.tree.other(e, v) as usize];
            }
            let b = block_of[vi] as usize;
            if size[b] == 0 {
                head[b] = v;
            } else {
                next[tail[b] as usize] = v;
            }
            tail[b] = v;
            next[vi] = NONE;
            size[b] += 1;
            least[b] = least[b].min(v);
            block_weight[b] += weight[vi];
            weighted[b] += weight[vi] * (x0[vi] - off[vi]);
        }
        for ((p, &w), &sum) in pos
            .iter_mut()
            .zip(weighted.iter())
            .zip(block_weight.iter())
            .take(count)
        {
            *p = w / sum;
        }
        *block_count = count;
    }

    /// Moves every member of block `b` by `delta` in its offset.
    fn shift_block(&mut self, b: usize, delta: f64) {
        let mut v = self.head[b];
        while v != NONE {
            self.off[v as usize] += delta;
            v = self.next[v as usize];
        }
        self.weighted[b] -= delta * self.block_weight[b];
    }
}
