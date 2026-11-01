//! The plain data routing reads. The driver (`engine/phases/routing.rs`) states it from the layered graph, the placement and
//! the options, so that route needs no other module of the crate. Indices refer to the graph: a node index is its index
//! in `Graph::nodes`, a cluster index its index in `Graph::clusters`, and a box index the index of the plan's box.

/// One real node: its rank, its centre along and across the ranks, its half-extent across them, and the boxes that hold it
/// (its own cluster and each ancestor, as box indices).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct NodeInput {
    /// The rank the node sits on.
    pub(crate) rank: usize,
    /// The node's centre along the ranks (its in-rank coordinate).
    pub(crate) along: f64,
    /// The node's centre across the ranks, as placement solved it. Only the levels route reads it: the rows route stacks
    /// the ranks itself.
    pub(crate) across: f64,
    /// Half the node's extent across the ranks.
    pub(crate) half: f64,
    /// The indices of the cluster boxes that hold the node.
    pub(crate) holders: Vec<usize>,
}

/// One cluster box of the plan: the cluster it is of, its edges along the ranks, the ranks it spans, its padding and label
/// height, its parent box, and whether it is opaque.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ClusterInput {
    /// The index of the cluster in `Graph::clusters`.
    pub(crate) cluster: usize,
    /// The box's left edge along the ranks, in the drawing's frame.
    pub(crate) left: f64,
    /// The box's right edge along the ranks, in the drawing's frame.
    pub(crate) right: f64,
    /// The first rank the box spans.
    pub(crate) top: usize,
    /// The last rank the box spans.
    pub(crate) bottom: usize,
    /// The padding the box keeps around its members across the ranks.
    pub(crate) padding: f64,
    /// The height of the box's label, above its first rank.
    pub(crate) label_height: f64,
    /// The index of the box that holds this one, when there is one.
    pub(crate) parent: Option<usize>,
    /// Whether the box is opaque: no foreign edge may enter it.
    pub(crate) opaque: bool,
    /// The box's top and bottom edges across the ranks, as placement solved them under `ranks: "levels"`. `None` under the
    /// rows, where the ranks are re-stacked and the box takes its extent from them.
    pub(crate) across: Option<(f64, f64)>,
}

/// A stop of an edge's chain: a real end or a dummy, with its rank, the in-rank coordinate where the edge is at it, the
/// across coordinate of its centre, and its half-extent across the ranks (zero for a dummy).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Stop {
    /// The rank of the stop.
    pub(crate) rank: usize,
    /// The in-rank coordinate of the edge at the stop.
    pub(crate) along: f64,
    /// The across coordinate of the stop's centre, as placement solved it. Only the levels route reads it.
    pub(crate) across: f64,
    /// Half the stop's extent across the ranks; zero for a dummy.
    pub(crate) half: f64,
    /// The across offset, from the rank's centre, at which the edge leaves or meets the stop. Zero except at a lateral
    /// port: its owner's side and its port dummy sit at the port's offset, so a stub between them runs straight across.
    pub(crate) side: f64,
}

/// One edge: whether its kind is routed, its real ends as node indices, and its stops from the source end to the target
/// end. The stops are empty when no bundle carries the edge (a self-loop, or an edge with unknown ends).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EdgeInput {
    /// Whether the edge's kind is routed (`routed` is not false).
    pub(crate) routed: bool,
    /// The node index of the source end; zero when the ends are unknown.
    pub(crate) source: usize,
    /// The node index of the target end; zero when the ends are unknown.
    pub(crate) target: usize,
    /// The stops from the source end to the target end.
    pub(crate) stops: Vec<Stop>,
    /// The trunk of the edge: the source port it leaves from, keyed by its source node and that port. Edges with one trunk
    /// never count as crossing each other, as `measure` counts them. `None` for an edge with no source port.
    pub(crate) trunk: Option<usize>,
}

/// Everything the rows route reads.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RouteInput {
    /// Whether the ranks run down the drawing.
    pub(crate) down: bool,
    /// The space between two tracks (`spacing.edge`).
    pub(crate) edge_gap: f64,
    /// The smallest rank gap (`spacing.rank`).
    pub(crate) rank_gap: f64,
    /// The number of ranks.
    pub(crate) ranks: usize,
    /// The margin the boxes take past each rank's bottom, by rank.
    pub(crate) below: Vec<f64>,
    /// The margin the boxes take before each rank's top, by rank.
    pub(crate) above: Vec<f64>,
    /// The rank of the anchor, which is moved to the origin across the ranks.
    pub(crate) anchor_rank: Option<usize>,
    /// The real nodes, by node index.
    pub(crate) nodes: Vec<NodeInput>,
    /// The cluster boxes, in the plan's order.
    pub(crate) clusters: Vec<ClusterInput>,
    /// The edges, by edge index.
    pub(crate) edges: Vec<EdgeInput>,
    /// The most overlapping pairs of runs the track assignment examines in a band (`Budget::route_pairs`).
    pub(crate) route_pairs: usize,
}
