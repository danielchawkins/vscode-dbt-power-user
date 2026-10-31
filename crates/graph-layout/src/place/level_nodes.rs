//! The across separations of the layered nodes for `ranks: "levels"`, a port of
//! `packages/graph-layout/src/place/levelNodes.ts`. Which bundles are directed is a graph question (a cycle's edges
//! carry no direction), so the caller states it on each segment: `place` reads no graph (ADR 0011, module table).

use super::links::Segment;
use super::problem::variable;
use crate::solve::Separation;

/// What the across separations of the layered nodes are drawn from.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LevelNodeInput<'a> {
    /// Each layered node's rank.
    pub(crate) ranks: &'a [usize],
    /// Whether each layered node is real (it has an id), not a dummy.
    pub(crate) real: &'a [bool],
    /// The layered segments; a directed one orders its ends across the ranks.
    pub(crate) segments: &'a [Segment],
    /// Each layered node's position along the ranks, and half its extent there.
    pub(crate) in_rank: &'a [f64],
    pub(crate) half_in: &'a [f64],
    /// Each layered node's half-extent across the ranks.
    pub(crate) half_across: &'a [f64],
    /// The gap between rank `r` and rank `r + 1`, as the rows use it.
    pub(crate) rank_gap: &'a [f64],
    /// The gap between two real nodes that overlap across the ranks.
    pub(crate) spacing_node: f64,
    /// The gap between a real node and a dummy, or two dummies, that overlap across the ranks.
    pub(crate) spacing_edge: f64,
}

/// The across separations among layered nodes: the directed segments first, then the overlapping pairs.
pub(crate) fn node_separations(input: &LevelNodeInput<'_>) -> Vec<Separation> {
    let mut out = segment_separations(input);
    out.extend(overlap_separations(input));
    out
}

/// Each directed segment puts its lower end below its upper end by both half-extents and the rank gap.
fn segment_separations(input: &LevelNodeInput<'_>) -> Vec<Separation> {
    input
        .segments
        .iter()
        .filter(|segment| segment.directed)
        .map(|segment| {
            let upper = input.ranks[segment.top];
            let lower = input.ranks[segment.bottom];
            assert!(
                upper < lower,
                "directed segment from rank {upper} to rank {lower} does not descend a rank"
            );
            let gap = input.half_across[segment.top]
                + input.half_across[segment.bottom]
                + input.rank_gap[upper];
            Separation {
                from: variable(segment.top),
                to: variable(segment.bottom),
                gap,
            }
        })
        .collect()
}

/// Pairs of nodes of different ranks whose in-rank extents overlap. Sorted by their lower in-rank edge (ties by index),
/// each node is compared only with those that start before its upper edge ends, so the scan stays near linear on
/// sparse rows.
fn overlap_separations(input: &LevelNodeInput<'_>) -> Vec<Separation> {
    let low = |i: usize| input.in_rank[i] - input.half_in[i];
    let high = |i: usize| input.in_rank[i] + input.half_in[i];
    let mut order: Vec<usize> = (0..input.ranks.len()).collect();
    // `partial_cmp` makes -0 and 0 equal, as the TypeScript difference does, so the index breaks their tie alike.
    order.sort_by(|&a, &b| {
        low(a)
            .partial_cmp(&low(b))
            .expect("in-rank edges are finite")
            .then(a.cmp(&b))
    });
    let mut out = Vec::new();
    for (a, &u) in order.iter().enumerate() {
        for &v in &order[a + 1..] {
            if low(v) >= high(u) {
                break;
            }
            if low(u) < high(v) && input.ranks[u] != input.ranks[v] {
                out.push(overlap_pair(input, u, v));
            }
        }
    }
    out
}

/// The separation that keeps two overlapping nodes apart across the ranks, the one of the smaller rank first.
fn overlap_pair(input: &LevelNodeInput<'_>, u: usize, v: usize) -> Separation {
    let (upper, lower) = if input.ranks[u] < input.ranks[v] {
        (u, v)
    } else {
        (v, u)
    };
    let both_real = input.real[u] && input.real[v];
    let gap = input.half_across[u]
        + input.half_across[v]
        + if both_real {
            input.spacing_node
        } else {
            input.spacing_edge
        };
    Separation {
        from: variable(upper),
        to: variable(lower),
        gap,
    }
}
