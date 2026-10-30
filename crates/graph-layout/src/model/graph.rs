//! The input graph, struct-of-arrays: one column per field of `LayoutNode`, `LayoutPort`, `LayoutEdge` and
//! `LayoutCluster`, and row i of a column is the i-th element of the input array. Ids and references stay strings,
//! as they arrive; `validate` checks each one. A port names its node by index, which is dense and follows input order.

/// The input graph (`LayoutGraph`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Graph {
    /// The nodes and their ports.
    pub nodes: Nodes,
    /// The edges.
    pub edges: Edges,
    /// The clusters. Empty when the graph has none.
    pub clusters: Clusters,
}

/// The nodes (`LayoutNode`), and the ports they own.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Nodes {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// The width, finite and positive once validated.
    pub width: Vec<f64>,
    /// The height, finite and positive once validated.
    pub height: Vec<f64>,
    /// The innermost cluster the node belongs to, by cluster id.
    pub cluster: Vec<Option<String>>,
    /// The node's band. `None` is a node in no band.
    pub partition: Vec<Option<f64>>,
    /// The ports of all nodes, in input order.
    pub ports: Ports,
}

/// The ports (`LayoutPort`) of all nodes, one row per port.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Ports {
    /// The index of the node that owns the port, in `Nodes`.
    pub node: Vec<u32>,
    /// Unique within its node.
    pub id: Vec<String>,
    /// The side the port sits on, as its name (`north`, `east`, `south` or `west`).
    pub side: Vec<String>,
    /// Distance from the side's start to the port.
    pub offset: Vec<f64>,
}

/// The edges (`LayoutEdge`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Edges {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// The id of the source node.
    pub source: Vec<String>,
    /// The id of the target node.
    pub target: Vec<String>,
    /// A port id on the source node.
    pub source_port: Vec<Option<String>>,
    /// A port id on the target node.
    pub target_port: Vec<Option<String>>,
    /// A key of the options' `edge_kinds`.
    pub kind: Vec<String>,
}

/// The clusters (`LayoutCluster`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Clusters {
    /// Unique within the graph.
    pub id: Vec<String>,
    /// The enclosing cluster, by id.
    pub parent: Vec<Option<String>>,
    /// Space between the box and its members.
    pub padding: Vec<Option<f64>>,
    /// Room for a label above the members.
    pub label_height: Vec<Option<f64>>,
    /// A wall: no edge may enter the box unless it contains one of the edge's ends.
    pub opaque: Vec<Option<bool>>,
}
