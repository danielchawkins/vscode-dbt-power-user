//! The in-rank placement problem, a port of `packages/graph-layout/src/place/problem.ts`. Each node's coordinate is its
//! centre along the in-rank axis. The ranks give the separation constraints; the links and pulls give the objective.
//! `place` cannot read the layered graph of `layering`, so the caller states the problem in these plain types.

use crate::solve::Separation;

/// The in-rank placement problem: nodes are numbered `0..dummy.len()`, and the variables after them are the cluster
/// box edges of `extra`.
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
    /// The soft pulls of single nodes towards a target, in input order.
    pub(crate) pulls: Vec<Pull>,
    /// Cluster box edges: variables after the nodes, and every separation among all variables. Absent when there are no
    /// clusters; then the rank chains alone are the separations.
    pub(crate) extra: Option<Extension>,
}

impl Problem {
    /// The number of variables: the nodes, then the box edges.
    pub(crate) fn variables(&self) -> usize {
        self.dummy.len() + self.extra.as_ref().map_or(0, |extra| extra.count)
    }
}

/// A segment between adjacent ranks, pulling its two ends together.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Link {
    /// The node at the upper end (the smaller rank).
    pub(crate) top: usize,
    /// The node at the lower end.
    pub(crate) bottom: usize,
    /// Straightening weight of the segment, already scaled for dummies.
    pub(crate) weight: f64,
    /// Port offset of each end from its node's centre along the in-rank axis.
    pub(crate) top_offset: f64,
    pub(crate) bottom_offset: f64,
}

impl Link {
    /// A unit-weight link without offsets, for tests.
    #[cfg(test)]
    pub(crate) fn new(top: usize, bottom: usize) -> Self {
        Self {
            top,
            bottom,
            weight: 1.0,
            top_offset: 0.0,
            bottom_offset: 0.0,
        }
    }
}

/// A soft pull of one node towards a target coordinate, weighted against the links.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pull {
    pub(crate) node: usize,
    pub(crate) weight: f64,
    pub(crate) target: f64,
}

/// Variables beyond the layered nodes, and the separations among all of them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Extension {
    pub(crate) count: usize,
    pub(crate) separations: Vec<Separation>,
}
