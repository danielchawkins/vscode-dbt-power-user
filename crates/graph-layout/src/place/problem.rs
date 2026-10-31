//! The in-rank placement problem, a port of `packages/graph-layout/src/place/problem.ts`. Each node's coordinate is its
//! centre along the in-rank axis. The ranks give the separation constraints; the links and pulls give the objective.
//! `place` cannot read the layered graph of `layering`, so the caller states the problem in these plain types.

/// The in-rank placement problem: nodes are numbered `0..dummy.len()`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Problem {
    /// Nodes of each rank, from left to right: the order that placement must keep.
    pub(crate) layers: Vec<Vec<usize>>,
    /// Least distance between each node's centre and its left neighbour's, by node; 0 for a rank's leftmost node.
    pub(crate) gap_left: Vec<f64>,
    /// Whether each node is a dummy.
    pub(crate) dummy: Vec<bool>,
    /// The segments between adjacent ranks, in input order.
    pub(crate) links: Vec<Link>,
}

/// A segment between adjacent ranks, pulling its two ends together.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Link {
    /// The node at the upper end (the smaller rank).
    pub(crate) top: usize,
    /// The node at the lower end.
    pub(crate) bottom: usize,
}
