//! The options of one run (`LayoutOptions`). They are a JSON-shaped object on the wire (ADR 0011, "Data layout"), so
//! the derives keep the camelCase names of `types.ts`.

use std::collections::BTreeMap;

use super::Hints;

/// The direction ranks run (`LayoutOptions.direction`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "lowercase")
)]
pub enum Direction {
    /// Sources at the top.
    #[default]
    Down,
    /// Sources at the left.
    Right,
}

/// How partitions constrain ranks (`LayoutOptions.partitions`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "lowercase")
)]
pub enum Partitions {
    /// Partitions are ignored.
    None,
    /// A backward crossing of a boundary costs ranking weight.
    #[default]
    Soft,
    /// A backward crossing of a boundary is forbidden.
    Strict,
}

/// How the across axis is drawn (`LayoutOptions.ranks`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "lowercase")
)]
pub enum Ranks {
    /// Each rank is one shared row.
    #[default]
    Rows,
    /// Each node gets its rank's level, pushed below the nodes its ranking edges place above it.
    Levels,
}

/// How one kind of edge takes part in each phase (`EdgeKindPolicy`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct EdgeKindPolicy {
    /// The edge orders its ends in rank: source before target.
    pub ranks: bool,
    /// Smallest rank span of a ranking edge. Defaults to 1.
    pub min_length: Option<f64>,
    /// Pull in ranking, ordering and placement, relative to 1. Defaults to 1.
    pub weight: Option<f64>,
    /// The edge is routed and returned. Defaults to true.
    pub routed: Option<bool>,
    /// The side the edge leaves its source on, when it names no source port. Checked by `validate` as a side name.
    pub source_side: Option<String>,
    /// The side the edge enters its target on, when it names no target port. Checked by `validate` as a side name.
    pub target_side: Option<String>,
}

/// The distances between nodes, ranks, edges and clusters (`Spacing`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Spacing {
    /// Between two nodes in one rank.
    pub node: f64,
    /// Least space between two ranks, before routing widens it.
    pub rank: f64,
    /// Between two parallel edge segments, and between an edge and a node.
    pub edge: f64,
    /// Between two cluster boxes.
    pub cluster: f64,
}

/// Overrides of `Spacing` (`Partial<Spacing>`): a field that is `None` keeps the default.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct PartialSpacing {
    /// See `Spacing::node`.
    pub node: Option<f64>,
    /// See `Spacing::rank`.
    pub rank: Option<f64>,
    /// See `Spacing::edge`.
    pub edge: Option<f64>,
    /// See `Spacing::cluster`.
    pub cluster: Option<f64>,
}

/// The options of one run (`LayoutOptions`).
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "camelCase")
)]
pub struct Options {
    /// The direction ranks run.
    pub direction: Direction,
    /// The policy of every edge kind the graph uses, by kind name.
    pub edge_kinds: BTreeMap<String, EdgeKindPolicy>,
    /// Overrides of the default spacing.
    pub spacing: Option<PartialSpacing>,
    /// How partitions constrain ranks. `None` means the default, `soft`.
    pub partitions: Option<Partitions>,
    /// How the across axis is drawn. `None` means the default, `rows`.
    pub ranks: Option<Ranks>,
    /// A node kept at the origin, by id.
    pub anchor: Option<String>,
    /// The previous result's hints, fed back so a grown graph keeps its shape.
    pub hints: Option<Hints>,
    /// Weight of the hint terms against edge length. `None` means the default, 1.
    pub stability: Option<f64>,
    /// How much search the ordering phase spends: `fast`, `balanced` or `thorough`. `None` means `balanced`.
    pub effort: Option<String>,
    /// Seed for the tie-breaking that `thorough` randomises.
    pub seed: Option<f64>,
}
