//! The left-to-right order of sibling cluster boxes, a port of `packages/graph-layout/src/place/boxOrder.ts`. Siblings are
//! clusters that share a parent; they keep one order in every rank where both appear.

use std::collections::{BTreeMap, BTreeSet};

use super::problem::variable;
use crate::solve::Separation;

/// The parts of a cluster box that sibling ordering reads: its parent, its left and right edge variables, and the first
/// and last rank it spans.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Span {
    pub(crate) parent: Option<usize>,
    pub(crate) left: usize,
    pub(crate) right: usize,
    pub(crate) top: usize,
    pub(crate) bottom: usize,
}

/// The left-to-right order of the clusters that share a parent, the same in every rank where both appear. Each rank
/// gives the order of the clusters it shows; the orders are merged by a topological sort, smallest index first, so that
/// the sibling boxes of the whole drawing take one order.
pub(crate) fn sibling_order(
    layers: &[Vec<usize>],
    paths: &[Vec<usize>],
    clusters: usize,
) -> Vec<usize> {
    let mut after: BTreeMap<usize, BTreeSet<usize>> = BTreeMap::new();
    for layer in layers {
        let mut last: BTreeMap<Option<usize>, usize> = BTreeMap::new();
        for &x in layer {
            let path = &paths[x];
            for (d, &c) in path.iter().enumerate() {
                let parent = (d > 0).then(|| path[d - 1]);
                if let Some(prev) = last.get(&parent).copied().filter(|&prev| prev != c) {
                    after.entry(prev).or_default().insert(c);
                }
                last.insert(parent, c);
            }
        }
    }
    topological(clusters, &after)
}

/// A topological order of `count` items with edges `after`, smallest ready index first. Items on a cycle fall back to
/// the smallest unfinished index, as the TypeScript does.
fn topological(count: usize, after: &BTreeMap<usize, BTreeSet<usize>>) -> Vec<usize> {
    // Signed, as TypeScript's counts are: a cycle can take an item's count below zero.
    let mut indegree = vec![0_i64; count];
    for targets in after.values() {
        for &t in targets {
            indegree[t] += 1;
        }
    }
    let mut done = vec![false; count];
    let mut order = Vec::with_capacity(count);
    while order.len() < count {
        let ready = (0..count).find(|&c| !done[c] && indegree[c] == 0);
        let Some(pick) = ready.or_else(|| (0..count).find(|&c| !done[c])) else {
            break;
        };
        done[pick] = true;
        order.push(pick);
        if let Some(targets) = after.get(&pick) {
            for &t in targets {
                indegree[t] -= 1;
            }
        }
    }
    order
}

/// Each box lies left of every later sibling box in `order` whose rank span overlaps its own, a spacing apart. Siblings
/// that share no rank are not separated, so they may share x; siblings share their parent's key. `spans` has one entry
/// per cluster, `None` for a cluster with no box.
pub(crate) fn siblings(order: &[usize], spans: &[Option<Span>], spacing: f64) -> Vec<Separation> {
    let mut placed: BTreeMap<Option<usize>, Vec<Span>> = BTreeMap::new();
    let mut out = Vec::new();
    for &c in order {
        let Some(span) = spans.get(c).copied().flatten() else {
            continue;
        };
        let earlier = placed.entry(span.parent).or_default();
        for prev in earlier.iter() {
            if prev.top <= span.bottom && span.top <= prev.bottom {
                out.push(Separation {
                    from: variable(prev.right),
                    to: variable(span.left),
                    gap: spacing,
                });
            }
        }
        earlier.push(span);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Span, sibling_order, siblings};

    fn span(parent: Option<usize>, left: usize, top: usize, bottom: usize) -> Span {
        Span {
            parent,
            left,
            right: left + 1,
            top,
            bottom,
        }
    }

    #[test]
    fn a_rank_shows_its_clusters_in_its_left_to_right_order() {
        // Node 0 is in cluster 0 and node 1 in cluster 1; rank [0, 1] puts cluster 0 first.
        let paths = [vec![0], vec![1]];
        assert_eq!(sibling_order(&[vec![0, 1]], &paths, 2), vec![0, 1]);
        assert_eq!(sibling_order(&[vec![1, 0]], &paths, 2), vec![1, 0]);
    }

    #[test]
    fn a_cycle_between_ranks_falls_back_to_index_order() {
        let paths = [vec![0], vec![1]];
        let layers = [vec![0, 1], vec![1, 0]];
        assert_eq!(sibling_order(&layers, &paths, 2), vec![0, 1]);
    }

    #[test]
    fn siblings_sharing_a_rank_are_kept_apart_and_disjoint_ones_are_not() {
        // Clusters 0 and 1 are siblings (no parent): 0 spans ranks 0 to 1, 1 spans rank 1, 2 spans rank 2 alone.
        let spans = [
            Some(span(None, 4, 0, 1)),
            Some(span(None, 6, 1, 1)),
            Some(span(None, 8, 2, 2)),
        ];
        let seps = siblings(&[0, 1, 2], &spans, 12.0);
        assert_eq!(seps.len(), 1);
        assert_eq!((seps[0].from, seps[0].to, seps[0].gap), (5, 6, 12.0));
    }

    #[test]
    fn clusters_under_different_parents_are_not_ordered_together() {
        let spans = [Some(span(Some(9), 4, 0, 0)), Some(span(None, 6, 0, 0))];
        let seps = siblings(&[0, 1], &spans, 12.0);
        assert_eq!(seps.len(), 0);
    }
}
