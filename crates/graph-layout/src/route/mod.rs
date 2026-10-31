//! Routing of the rows layout (`ranks: "rows"`, the default): the orthogonal polyline of each edge, the bands between
//! ranks that carry them, and the re-stacked ranks and cluster boxes they are drawn against. A port of the rows route of
//! `packages/graph-layout/src/route/` (`index.ts`, `polylines.ts`, `pieces.ts`, `channel*.ts`, `drawingSegments.ts` and
//! `opaque.ts`). It reads plain data only (`RouteInput`), which the driver states in `engine/phases/routing.rs`, so this
//! module imports nothing from the crate (ADR 0011, module table; rule `rust-core-layer-imports-route`).
//!
//! Each edge is a chain of stops from its source end to its target end: its two real ends and the dummies between
//! them. A run joins two adjacent stops and lies in a band: the band below the upper stop's rank, or below the rank
//! itself for a flat run (both ends on one rank). In each band, a run whose horizontal piece overlaps another's gets a
//! track of its own (`bands`); the band is `(tracks + 1) * edge` tall, at least the rank gap, plus the margins of the
//! cluster boxes that end and start beside it, and the ranks are stacked with those heights (`stack`). The in-rank
//! coordinates that placement chose are kept. A run's polyline goes down from its upper stop to its track, across it,
//! and on to the lower stop (`polyline`).
//!
//! Simplifications against TypeScript, all of them choices of this port: a run takes one track and never doglegs
//! (TypeScript may jog a run to a second track); the tracks are the fewest that keep the runs of a band apart, found
//! greedily by start, which is optimal for intervals; there is no pair budget and no crossing count; lateral ports are
//! refused before routing (`engine/phases.rs`), so there are no stubs.
//!
//! Which edges are drawn. A self-loop is `RouteFailed`: it takes no run and is flagged, as `types.ts` says of a
//! self-loop. An edge of a kind with `routed: false` is `NotRouted`: it is a pure layout constraint and has no entry.
//! Every other edge is `Routed`, or `RouteFailed` when it has no valid stops, or when one of its segments enters an
//! opaque cluster box it may not enter, or comes within `OPAQUE_CLEARANCE` of its border (`opaque`). A failed edge is
//! flagged and not re-routed.
//!
//! Not yet: `ranks: "levels"` (`levelRoutes.ts`) is step 2b. `pending_levels` flags every drawn edge `RouteFailed`,
//! keeps the placement's points as the nodes, and returns no cluster boxes.

mod bands;
mod clusters;
mod input;
mod opaque;
mod polyline;
mod stack;
#[cfg(test)]
mod tests;

pub(crate) use input::{ClusterInput, EdgeInput, NodeInput, RouteInput, Stop};
pub(crate) use opaque::{breaches, same_coordinate};

use bands::assign;
use polyline::polyline;
use stack::stack;

/// A point of the drawing: `x` grows to the right and `y` down.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    /// The horizontal coordinate.
    pub x: f64,
    /// The vertical coordinate.
    pub y: f64,
}

/// An axis-aligned rectangle of the drawing: its top-left corner and its size.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    /// The left edge.
    pub x: f64,
    /// The top edge.
    pub y: f64,
    /// The width.
    pub width: f64,
    /// The height.
    pub height: f64,
}

/// The route of one edge.
#[derive(Debug, Clone, PartialEq)]
pub enum EdgeRoute {
    /// The orthogonal polyline from the source end to the target end, bends included.
    Routed(Vec<Point>),
    /// The edge is drawn by no polyline: it is a self-loop, has no valid stops, or a segment breaches an opaque box.
    RouteFailed,
    /// The edge's kind is not routed (`routed: false`): it takes no part in the drawing.
    NotRouted,
}

/// The rectangle of one cluster box, with the cluster it is of (its index in `Graph::clusters`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClusterBox {
    /// The index of the cluster in `Graph::clusters`.
    pub cluster: usize,
    /// The box's rectangle in the re-stacked drawing.
    pub rect: Rect,
}

/// What routing did, as counts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RouteWork {
    /// Tracks used, summed over every band.
    pub tracks: usize,
    /// Edges flagged `RouteFailed` because a segment breached an opaque box.
    pub opaque_failures: usize,
}

/// The routing of a layout: the centre of each real node once the bands are widened, the route of each edge, the
/// cluster boxes of the re-stacked ranks and what routing did.
#[derive(Debug, Clone, PartialEq)]
pub struct Routing {
    /// The centre of each real node, by node index in `Graph::nodes`.
    pub nodes: Vec<Point>,
    /// The route of each edge, by edge index in `Graph::edges`.
    pub edges: Vec<EdgeRoute>,
    /// The rectangle of each cluster box, in the order of the plan's boxes. Empty when there are no clusters, and under
    /// `ranks: "levels"` until that route lands.
    pub clusters: Vec<ClusterBox>,
    /// What routing did.
    pub work: RouteWork,
}

/// Routes the rows layout of `input`: the tracks of each band, the re-stacked ranks, the polyline of each drawable
/// edge, and the cluster boxes. An edge whose polyline breaches an opaque box it may not enter is `RouteFailed`.
pub(crate) fn route(input: &RouteInput) -> Routing {
    let drawable: Vec<bool> = input.edges.iter().map(drawable).collect();
    let plan = assign(input, &drawable);
    let stacked = stack(input, &plan.counts);
    let rects = clusters::boxes(input, &stacked);
    let mut work = RouteWork {
        tracks: plan.counts.iter().sum(),
        opaque_failures: 0,
    };
    let edges = input
        .edges
        .iter()
        .enumerate()
        .map(|(e, edge)| {
            if !edge.routed {
                return EdgeRoute::NotRouted;
            }
            if !drawable[e] {
                return EdgeRoute::RouteFailed;
            }
            let points = polyline(
                &edge.stops,
                &plan.runs[e],
                &stacked,
                input.edge_gap,
                input.down,
            );
            let watched = watched_boxes(input, edge);
            if breaches(&points, &rects, &watched).is_empty() {
                EdgeRoute::Routed(points)
            } else {
                work.opaque_failures += 1;
                EdgeRoute::RouteFailed
            }
        })
        .collect();
    let nodes = input
        .nodes
        .iter()
        .map(|node| frame(input.down, node.along, stacked.centre(node.rank)))
        .collect();
    let clusters = input
        .clusters
        .iter()
        .zip(rects)
        .map(|(cluster, rect)| ClusterBox {
            cluster: cluster.cluster,
            rect,
        })
        .collect();
    Routing {
        nodes,
        edges,
        clusters,
        work,
    }
}

/// The routing of a layout under `ranks: "levels"`, until its route lands (step 2b): every drawn edge is `RouteFailed`,
/// every other is `NotRouted`, the nodes are the given points, and there are no cluster boxes and no tracks.
pub(crate) fn pending_levels(edges: &[EdgeInput], nodes: Vec<Point>) -> Routing {
    Routing {
        nodes,
        edges: edges
            .iter()
            .map(|edge| {
                if edge.routed {
                    EdgeRoute::RouteFailed
                } else {
                    EdgeRoute::NotRouted
                }
            })
            .collect(),
        clusters: Vec::new(),
        work: RouteWork::default(),
    }
}

/// Whether an edge gets a polyline: its kind is routed, it is not a self-loop, and its stops are a chain whose
/// neighbours are on the same rank or on adjacent ranks.
fn drawable(edge: &EdgeInput) -> bool {
    edge.routed
        && edge.source != edge.target
        && edge.stops.len() >= 2
        && edge
            .stops
            .windows(2)
            .all(|pair| pair[0].rank.abs_diff(pair[1].rank) <= 1)
}

/// The cluster boxes an edge may enter: those that hold its source or its target. Every other opaque box is watched.
fn watched_boxes(input: &RouteInput, edge: &EdgeInput) -> Vec<bool> {
    let holds = |node: usize, cluster: usize| {
        input
            .nodes
            .get(node)
            .is_some_and(|n| n.holders.contains(&cluster))
    };
    input
        .clusters
        .iter()
        .enumerate()
        .map(|(b, cluster)| cluster.opaque && !holds(edge.source, b) && !holds(edge.target, b))
        .collect()
}

/// A point given its along-the-ranks coordinate and its across-the-ranks coordinate, in the drawing's frame. Ranks run
/// down the drawing when `down`, else to the right.
fn frame(down: bool, along: f64, across: f64) -> Point {
    if down {
        Point {
            x: along,
            y: across,
        }
    } else {
        Point {
            x: across,
            y: along,
        }
    }
}

/// A count as a float. Counts in routing are far below 2^32.
fn count(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}
