//! A Fenwick (binary indexed) tree over weights: point updates and prefix sums in O(log n). A port of
//! `packages/graph-layout/src/fenwick.ts`. The sums are taken in the same order as the TypeScript loops, so every
//! prefix equals TypeScript's bit for bit. The crossing count of `order` reads it.
//!
//! The entries are `f64`, not integers as the plan first said. `countCrossings` adds the weights of links, and those
//! are fractional: a link at a half-weight column adds `column: 0.5`, and an integer tree would round it. Integer
//! weights stay exact in binary64, so the integer tests below still compare against a plain sum.

#[cfg(test)]
mod tests;

/// A Fenwick tree over `size` entries, all zero to begin with. Index `i` of the tree holds the sum of a block of
/// entries ending at `i`, as in the TypeScript class, which keeps the same one-based layout.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Fenwick {
    tree: Vec<f64>,
}

impl Fenwick {
    /// An empty tree over `size` entries.
    #[must_use]
    pub(crate) fn new(size: usize) -> Self {
        Self {
            tree: vec![0.0; size + 1],
        }
    }

    /// Adds `delta` to the entry at `index`.
    pub(crate) fn add(&mut self, index: usize, delta: f64) {
        let len = self.tree.len();
        let mut i = index + 1;
        while i < len {
            self.tree[i] += delta;
            i += i.isolate_lowest_one();
        }
    }

    /// The sum of the entries before `end`, that is the entries at indices `0` to `end - 1`.
    #[must_use]
    pub(crate) fn prefix(&self, end: usize) -> f64 {
        let mut sum = 0.0;
        let mut i = end;
        while i > 0 {
            sum += self.tree[i];
            i &= i - 1;
        }
        sum
    }
}
