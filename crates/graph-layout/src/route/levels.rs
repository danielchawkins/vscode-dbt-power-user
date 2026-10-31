//! The route of `ranks: "levels"`, a port of `packages/graph-layout/src/route/levelRoutes.ts`. Under levels a rank is not a row:
//! each node is solved across the ranks on its own, so nothing is re-stacked and the bands between ranks are not shared.
//! Nodes and cluster boxes keep the positions placement gave them, and only the edges are routed.
//!
//! A run joins two adjacent stops of an edge. It leaves the upper stop from its bottom, goes down to the middle of the gap
//! between the two stops, runs across, and goes on to the lower stop. When the lower stop's top is not below the upper
//! stop's bottom (the two overlap across), the run leaves both from their bottoms and goes beneath both, so it does not
//! cut through either stop; its horizontal piece can still pass through other nodes. The runs of an edge are joined in
//! order from its source end, with repeated points and points that run straight on dropped (`polyline::push`).
//!
//! Simplifications against TypeScript: runs in one gap take its one midline, so two runs in one gap may share a
//! horizontal piece where they overlap, as TypeScript's do; there are no tracks and no crossing count. The gate is the
//! rows route's: a drawn edge's segment that enters an opaque box it may not enter, or comes within `OPAQUE_CLEARANCE` of
//! its border, flags the edge `RouteFailed`. The boxes it is checked against are the ones this route draws: placement's
//! solved boxes (`ClusterInput::across`), so the gate checks the drawing the caller receives.

use super::polyline::push;
use super::{
    ClusterBox, EdgeRoute, Point, Rect, RouteInput, RouteWork, Routing, Stop, breaches, drawable,
    frame, watched_boxes,
};

/// Routes every edge of a `ranks: "levels"` layout. The nodes are the centres placement gave them; an edge is drawn by
/// its runs, or flagged `RouteFailed` when it is a self-loop, has no valid stops, or a segment breaches an opaque box.
pub(crate) fn route_levels(input: &RouteInput) -> Routing {
    let rects = boxes(input);
    let mut work = RouteWork::default();
    let edges = input
        .edges
        .iter()
        .map(|edge| {
            if !edge.routed {
                return EdgeRoute::NotRouted;
            }
            if !drawable(edge) {
                return EdgeRoute::RouteFailed;
            }
            let points = path(&edge.stops, input.down, input.edge_gap);
            // A route of fewer than two points has no ends to join, so it is not a route.
            if points.len() < 2 {
                return EdgeRoute::RouteFailed;
            }
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
        .map(|node| frame(input.down, node.along, node.across))
        .collect();
    let clusters = input
        .clusters
        .iter()
        .zip(&rects)
        .map(|(cluster, &rect)| ClusterBox {
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

/// The rectangle of each cluster box, from the extent placement solved for it across the ranks. A box with no solved
/// extent takes an empty one; the driver gives every box one under levels.
fn boxes(input: &RouteInput) -> Vec<Rect> {
    input
        .clusters
        .iter()
        .map(|cluster| {
            let (top, bottom) = cluster.across.unwrap_or_default();
            let (left, right) = (cluster.left, cluster.right);
            if input.down {
                Rect {
                    x: left,
                    y: top,
                    width: right - left,
                    height: bottom - top,
                }
            } else {
                Rect {
                    x: top,
                    y: left,
                    width: bottom - top,
                    height: right - left,
                }
            }
        })
        .collect()
}

/// The polyline of an edge through its stops, from the source end to the target end: the run of each pair of adjacent
/// stops, joined in order. Repeated points and points that run straight on are dropped, so only the bends remain.
fn path(stops: &[Stop], down: bool, edge: f64) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::new();
    for pair in stops.windows(2) {
        for point in run(pair[0], pair[1], down, edge) {
            push(&mut out, point);
        }
    }
    out
}

/// The four points of the run from stop `from` to stop `to`, in that order: from the upper stop's bottom down to the middle
/// of the gap, across, and on to the lower stop. The upper stop is the one on the smaller rank; a flat run takes its
/// `from` as the upper stop. A run going up is computed from its upper stop and turned round.
fn run(from: Stop, to: Stop, down: bool, edge: f64) -> [Point; 4] {
    let flipped = to.rank < from.rank;
    let (upper, lower) = if flipped { (to, from) } else { (from, to) };
    let top = upper.across + upper.half;
    let lower_top = lower.across - lower.half;
    let points_down = lower_top > top;
    let bottom = if points_down {
        lower_top
    } else {
        lower.across + lower.half
    };
    let mid = if points_down {
        f64::midpoint(top, bottom)
    } else {
        top.max(bottom) + edge
    };
    let points = [
        frame(down, upper.along, top),
        frame(down, upper.along, mid),
        frame(down, lower.along, mid),
        frame(down, lower.along, bottom),
    ];
    if flipped {
        [points[3], points[2], points[1], points[0]]
    } else {
        points
    }
}
