//! The layered graph that ordering reads: the nodes of each rank, the segments that link a node to the rank below it, and
//! the blocks and cluster chains that keep units together. A port of `packages/graph-layout/src/layeredGraph.ts`. The
//! struct is filled by `layer` (the bundle and dummy-chain steps, then the segments, ports and spines of `layer.ts`).

/// The port a lateral-port dummy stands for: it sits in its owner's rank, beside the owner, and the bundle's edge leaves
/// the owner's side at the port's offset and runs to the dummy (`PortDummy`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PortDummy {
    /// Layered index of the owner, a real node in the same rank.
    pub(crate) owner: usize,
    /// Whether the dummy lies after the owner in the in-rank order.
    pub(crate) after: bool,
    /// Whether the run goes toward the band below the rank, else from above.
    pub(crate) below: bool,
    /// The port's offset from the start of its side.
    pub(crate) offset: f64,
}

/// A node of the layered graph: a real node, or a dummy that carries one bundle across an intermediate rank.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayeredNode {
    /// Index of the real node in the input graph, or `None` for a dummy.
    pub(crate) id: Option<usize>,
    pub(crate) rank: usize,
    /// Extent along the in-rank axis: the node's size, or a dummy's member count times the edge spacing.
    pub(crate) breadth: f64,
    /// Set on the dummy of a lateral port; `None` for every other node.
    pub(crate) port: Option<PortDummy>,
}

/// One link of a bundle's chain, between two adjacent ranks. Its ends are layered node indices, and each end's port
/// offset is taken from the node's centre along the in-rank axis (zero at a dummy, or where no port faces the rank).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Segment {
    pub(crate) top: usize,
    pub(crate) bottom: usize,
    pub(crate) weight: f64,
    pub(crate) top_offset: f64,
    pub(crate) bottom_offset: f64,
}

/// The layered graph. `block` gives each node's unit: the owner of a lateral port's dummy, else the node itself. A
/// block is kept contiguous in every rank. `paths` gives each node's block's cluster chain, outermost first.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LayeredGraph {
    pub(crate) nodes: Vec<LayeredNode>,
    pub(crate) segments: Vec<Segment>,
    pub(crate) block: Vec<usize>,
    pub(crate) paths: Vec<Vec<usize>>,
    /// Number of ranks, from 0 up to the highest rank.
    pub(crate) ranks: usize,
}
