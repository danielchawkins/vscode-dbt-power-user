//! Horizontal compaction of Brandes and Köpf (section 3), as corrected by the erratum of arXiv 2008.01252. A port of
//! `packages/graph-layout/src/place/bkCompaction.ts`.
//!
//! Each block is placed as far left as its neighbours allow, relative to its class's sink; then each class's shift is
//! set from the final shifts of the classes it is pulled against, so that shifts accumulate along the chain of classes;
//! and each vertex takes its block's coordinate plus its class's shift, once.

use super::alignment::{Blocks, Frame};

/// A separation between two classes: the class `from` must be shifted by no more than the class `on` is shifted plus
/// `gap`-adjusted bound, since the block `v` of class `on` sits `gap` to the right of the block `u` of class `from`.
#[derive(Debug, Clone, Copy, PartialEq)]
struct ClassBound {
    from: usize,
    on: usize,
    v: usize,
    u: usize,
    gap: f64,
}

/// A depth-first visit of the blocks to the left of one block's members: the block and the member the walk is at.
#[derive(Debug, Clone, Copy)]
struct Visit {
    v: usize,
    w: usize,
    started: bool,
}

/// The state of one compaction: each block's sink, its coordinate, and the class bounds found so far.
struct Compaction<'a> {
    frame: &'a Frame,
    root: &'a [usize],
    align: &'a [usize],
    sink: Vec<usize>,
    x: Vec<f64>,
    bounds: Vec<ClassBound>,
}

impl Compaction<'_> {
    /// Places the block of `v` against the blocks to the left of its members.
    fn place(&mut self, v: usize) {
        let mut w = v;
        loop {
            if let Some(left) = self.frame.left[w] {
                let u = self.root[left];
                if self.sink[v] == v {
                    self.sink[v] = self.sink[u];
                }
                if self.sink[v] == self.sink[u] {
                    self.x[v] = self.x[v].max(self.x[u] + self.frame.gap[w]);
                } else {
                    self.bounds.push(ClassBound {
                        from: self.sink[u],
                        on: self.sink[v],
                        v,
                        u,
                        gap: self.frame.gap[w],
                    });
                }
            }
            w = self.align[w];
            if w == v {
                break;
            }
        }
    }
}

/// The x of every node, compacted, in the pass's own frame.
pub(crate) fn compact(frame: &Frame, blocks: &Blocks) -> Vec<f64> {
    let root = &blocks.root;
    let n = root.len();
    let mut state = Compaction {
        frame,
        root,
        align: &blocks.align,
        sink: (0..n).collect(),
        x: vec![0.0; n],
        bounds: Vec::new(),
    };
    for v in block_order(frame, blocks) {
        state.place(v);
    }
    let shift = class_shifts(n, &state.bounds, &state.x);
    (0..n)
        .map(|v| {
            let r = root[v];
            state.x[r] + shift[state.sink[r]]
        })
        .collect()
}

/// The shift of each class: zero for a class no other class is pulled against, else the least of the shifts of the
/// classes it is pulled against plus their bounds. Classes are visited dependencies first, so each reads final shifts.
fn class_shifts(n: usize, bounds: &[ClassBound], x: &[f64]) -> Vec<f64> {
    // Per class, the classes it is pulled against, each with the bound that holds between them.
    let mut deps: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for b in bounds {
        deps[b.from].push((b.on, x[b.v] - x[b.u] - b.gap));
    }
    let mut shift = vec![0.0; n];
    for c in dependencies_first(&deps) {
        if !deps[c].is_empty() {
            let least = deps[c].iter().fold(f64::INFINITY, |least, &(on, bound)| {
                least.min(shift[on] + bound)
            });
            shift[c] = least;
        }
    }
    shift
}

/// The classes, each after every class it depends on: an iterative depth-first post-order, so a long chain does not
/// exhaust the stack.
fn dependencies_first(deps: &[Vec<(usize, f64)>]) -> Vec<usize> {
    let n = deps.len();
    let mut out = Vec::with_capacity(n);
    let mut seen = vec![false; n];
    for s in 0..n {
        if seen[s] {
            continue;
        }
        seen[s] = true;
        // Each frame is a class and the index of its next dependency.
        let mut stack: Vec<(usize, usize)> = vec![(s, 0)];
        while let Some(&(c, i)) = stack.last() {
            match deps[c].get(i) {
                None => {
                    stack.pop();
                    out.push(c);
                }
                Some(&(on, _)) => {
                    let top = stack.len() - 1;
                    stack[top].1 += 1;
                    if !seen[on] {
                        seen[on] = true;
                        stack.push((on, 0));
                    }
                }
            }
        }
    }
    out
}

/// The block roots, each after every block to the left of one of its members: the order in which compaction can place
/// them. Iterative, so a rank thousands of nodes wide does not exhaust the stack.
fn block_order(frame: &Frame, blocks: &Blocks) -> Vec<usize> {
    let root = &blocks.root;
    let align = &blocks.align;
    let n = root.len();
    let mut seen = vec![false; n];
    let mut out = Vec::new();
    for s in 0..n {
        if root[s] != s || seen[s] {
            continue;
        }
        seen[s] = true;
        let mut stack = vec![Visit {
            v: s,
            w: s,
            started: false,
        }];
        while let Some(&Visit { v, w, started }) = stack.last() {
            if started && w == v {
                stack.pop();
                out.push(v);
                continue;
            }
            let top = stack.len() - 1;
            stack[top].started = true;
            stack[top].w = align[w];
            let left = frame.left[w].map(|l| root[l]);
            if let Some(u) = left.filter(|&u| !seen[u]) {
                seen[u] = true;
                stack.push(Visit {
                    v: u,
                    w: u,
                    started: false,
                });
            }
        }
    }
    out
}
