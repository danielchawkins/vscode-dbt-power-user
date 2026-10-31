//! The layered graph that ordering reads: the nodes of each rank, the segments that link a node to the rank below it, and
//! the blocks and cluster chains that keep units together. A port of `packages/graph-layout/src/layeredGraph.ts`. The
//! struct is filled by `layer` (the bundle and dummy-chain steps, then the segments, ports and spines of `layer.ts`).
//! The types are public because `engine::run_phases` returns them.

/// The port a lateral-port dummy stands for: it sits in its owner's rank, beside the owner, and the bundle's edge leaves
/// the owner's side at the port's offset and runs to the dummy (`PortDummy`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PortDummy {
    /// Layered index of the owner, a real node in the same rank.
    pub owner: usize,
    /// Whether the dummy lies after the owner in the in-rank order.
    pub after: bool,
    /// Whether the run goes toward the band below the rank, else from above.
    pub below: bool,
    /// The port's offset from the start of its side.
    pub offset: f64,
}

/// A node of the layered graph: a real node, or a dummy that carries one bundle across an intermediate rank.
#[derive(Debug, Clone, PartialEq)]
pub struct LayeredNode {
    /// Index of the real node in the input graph, or `None` for a dummy.
    pub id: Option<usize>,
    /// The rank the node sits on.
    pub rank: usize,
    /// Extent along the in-rank axis: the node's size, or a dummy's member count times the edge spacing.
    pub breadth: f64,
    /// Set on the dummy of a lateral port; `None` for every other node.
    pub port: Option<PortDummy>,
}

/// One link of a bundle's chain, between two adjacent ranks. Its ends are layered node indices, and each end's port
/// offset is taken from the node's centre along the in-rank axis (zero at a dummy, or where no port faces the rank).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment {
    /// Layered index of the upper end.
    pub top: usize,
    /// Layered index of the lower end.
    pub bottom: usize,
    /// The weight of the bundle the segment belongs to.
    pub weight: f64,
    /// The port offset at the upper end, zero when no port faces the rank.
    pub top_offset: f64,
    /// The port offset at the lower end, zero when no port faces the rank.
    pub bottom_offset: f64,
}

/// The layered graph. `block` gives each node's unit: the owner of a lateral port's dummy, else the node itself. A
/// block is kept contiguous in every rank. `paths` gives each node's block's cluster chain, outermost first.
#[derive(Debug, Clone, PartialEq)]
pub struct LayeredGraph {
    /// The real nodes, in input order, then the dummies that were added.
    pub nodes: Vec<LayeredNode>,
    /// The links of each bundle's chain.
    pub segments: Vec<Segment>,
    /// The unit of each node, by layered index.
    pub block: Vec<usize>,
    /// The cluster chain of each node's block, by layered index, outermost cluster first.
    pub paths: Vec<Vec<usize>>,
    /// The spines: each runs from a cluster member through its spine dummies to the next member, as layered indices.
    pub spines: Vec<Vec<usize>>,
    /// Number of ranks, from 0 up to the highest rank.
    pub ranks: usize,
}
