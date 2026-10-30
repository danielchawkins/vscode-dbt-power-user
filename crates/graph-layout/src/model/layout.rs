//! The result (`LayoutResult`), struct-of-arrays. Row i of a node column is the i-th node of the input, and so on for
//! edges and clusters, so a result is indexed the way its input is.

use super::Rect;

/// The layout of one graph (`LayoutResult`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Layout {
    /// The placed nodes.
    pub nodes: NodeLayouts,
    /// The routed edges. Edges of a kind that is not routed are absent.
    pub edges: EdgeLayouts,
    /// The cluster boxes.
    pub clusters: ClusterRects,
    /// One box per partition some node sets.
    pub partitions: PartitionRects,
    /// The bounding box of the drawing.
    pub bounds: Rect,
    /// Feed to the next run as the options' hints.
    pub hints: Hints,
    /// Quality measures of the drawing.
    pub metrics: Metrics,
}

/// The placed nodes (`NodeLayout`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct NodeLayouts {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// Left edge.
    pub x: Vec<f64>,
    /// Top edge.
    pub y: Vec<f64>,
    /// Extent along x.
    pub width: Vec<f64>,
    /// Extent along y.
    pub height: Vec<f64>,
    /// The rank the node is in, lowest real node at 0.
    pub rank: Vec<u32>,
    /// The node's index among the real nodes of its rank, in drawing order.
    pub order: Vec<u32>,
}

/// The routed edges (`EdgeLayout`). The points of edge `e` are the rows `point_start[e]..point_start[e + 1]` of
/// `point_x` and `point_y`, so `point_start` has one more row than there are edges.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct EdgeLayouts {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// Index of each edge's first point, then one past the last.
    pub point_start: Vec<u32>,
    /// The x of each point, source end first.
    pub point_x: Vec<f64>,
    /// The y of each point, source end first.
    pub point_y: Vec<f64>,
    /// The edge was laid out against its direction.
    pub reversed: Vec<bool>,
    /// No route was found, or the edge is a self-loop. Its points are empty.
    pub route_failed: Vec<bool>,
}

/// The cluster boxes (`clusters` of `LayoutResult`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct ClusterRects {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// Left edge.
    pub x: Vec<f64>,
    /// Top edge.
    pub y: Vec<f64>,
    /// Extent along x.
    pub width: Vec<f64>,
    /// Extent along y.
    pub height: Vec<f64>,
}

/// The partition boxes (`partitions` of `LayoutResult`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct PartitionRects {
    /// The partition each box is for.
    pub partition: Vec<f64>,
    /// Left edge.
    pub x: Vec<f64>,
    /// Top edge.
    pub y: Vec<f64>,
    /// Extent along x.
    pub width: Vec<f64>,
    /// Extent along y.
    pub height: Vec<f64>,
}

/// The positions a layout can be fed back with (`LayoutHints`): rank, in-rank order and top-left corner per node.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Hints {
    /// The node id each row is for.
    pub id: Vec<String>,
    /// The rank of the node.
    pub rank: Vec<u32>,
    /// The node's index among the real nodes of its rank.
    pub order: Vec<u32>,
    /// The node's left edge.
    pub x: Vec<f64>,
    /// The node's top edge.
    pub y: Vec<f64>,
}

/// The quality measures of a drawing (`LayoutMetrics`). Counts are held as `f64`, as `types.ts` holds them.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Metrics {
    /// Edge crossings.
    pub crossings: f64,
    /// Bends over all routed edges.
    pub bends: f64,
    /// Sum of the polylines' lengths.
    pub edge_length: f64,
    /// Area of the bounds.
    pub area: f64,
    /// Total node area over the bounds' area.
    pub density: f64,
    /// Overlapping pairs of nodes, or of a node and an edge it does not end at.
    pub overlaps: f64,
    /// Pairs of an edge and an opaque box it may not enter.
    pub opaque_breaches: f64,
}
