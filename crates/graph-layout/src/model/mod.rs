//! The public input and output types: `Graph` in, `Layout` out, `Options` for a run, and `validate`, which refuses the
//! input that `layout` would refuse (ADR 0011, "Module boundaries"). The names are those of
//! `packages/graph-layout/src/types.ts`. The graph and the layout are struct-of-arrays; the input keeps its string ids
//! as they arrive, because `validate` has to see an unknown one to reject it. Serde derives sit behind the `serde`
//! feature and use the camelCase names of `types.ts`.

mod graph;
mod layout;
mod options;
mod validate;

pub use graph::{Clusters, Edges, Graph, Nodes, Ports};
pub use layout::{ClusterRects, EdgeLayouts, Hints, Layout, Metrics, NodeLayouts, PartitionRects};
pub use options::{Direction, EdgeKindPolicy, Options, PartialSpacing, Partitions, Ranks, Spacing};
pub use validate::{InputError, InputIssue, IssueCode, validate};

/// A point in the drawing's own frame: x to the right, y down.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Point {
    /// Distance to the right of the frame's origin.
    pub x: f64,
    /// Distance below the frame's origin.
    pub y: f64,
}

/// An axis-aligned rectangle: its top-left corner and its size.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Rect {
    /// The left edge.
    pub x: f64,
    /// The top edge.
    pub y: f64,
    /// Extent along x.
    pub width: f64,
    /// Extent along y.
    pub height: f64,
}

/// A side of a node, in the drawing's frame: north is the top, east the right, whatever the direction is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Serialize, serde::Deserialize),
    serde(rename_all = "lowercase")
)]
pub enum Side {
    /// The top side.
    North,
    /// The right side.
    East,
    /// The bottom side.
    South,
    /// The left side.
    West,
}

impl Side {
    /// The side named `name` as `types.ts` spells it, or `None` when the name is not a side.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "north" => Some(Self::North),
            "east" => Some(Self::East),
            "south" => Some(Self::South),
            "west" => Some(Self::West),
            _ => None,
        }
    }

    /// The name `types.ts` spells this side with.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::North => "north",
            Self::East => "east",
            Self::South => "south",
            Self::West => "west",
        }
    }
}
