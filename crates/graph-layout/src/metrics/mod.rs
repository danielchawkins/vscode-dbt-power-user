//! The measures of a drawing: crossings, bends, edge length, the area of its bounds, density, overlaps and opaque breaches
//! (`packages/graph-layout/src/metrics.ts`). A drawing is plain data, the node boxes, the drawn polylines and the opaque
//! boxes, so the measures need neither the route nor the phases. The definitions are those of `metrics.ts`.

mod crossings;
mod pieces;
#[cfg(test)]
mod tests;

use std::collections::BTreeSet;

use crate::model::{Metrics, Point, Rect};
use crossings::count_crossings;
use pieces::{Pieces, enters_box, pieces_of};

/// How far outside an opaque box a piece of an edge may run before it counts as touching the box (`opaque.ts`).
const OPAQUE_CLEARANCE: f64 = 1.0;

/// One edge as drawn: its polyline from the source end to the target end, the indices of the boxes of its two ends, and
/// its trunk. Edges with the same trunk never count as crossing each other; an edge with no trunk shares one with no
/// other edge.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DrawnPath {
    /// The points of the polyline, source end first.
    pub(crate) points: Vec<Point>,
    /// The index of the source node's box in `Drawing::boxes`.
    pub(crate) source: usize,
    /// The index of the target node's box in `Drawing::boxes`.
    pub(crate) target: usize,
    /// The trunk of the edge, such as its source port.
    pub(crate) trunk: Option<usize>,
}

/// The opaque boxes, and for each drawn path the boxes it may enter (those holding one of its ends). A path with no
/// entry in `allowed` may enter none.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Opaque {
    /// The opaque boxes.
    pub(crate) boxes: Vec<Rect>,
    /// For the path at each index of `Drawing::paths`, the indices of the boxes it may enter.
    pub(crate) allowed: Vec<BTreeSet<usize>>,
}

/// A drawing to measure: the node boxes and the drawn edges, and the opaque boxes if any.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Drawing {
    /// The node boxes.
    pub(crate) boxes: Vec<Rect>,
    /// The drawn edges. An edge that is not drawn is absent.
    pub(crate) paths: Vec<DrawnPath>,
    /// The opaque boxes. Without them, `opaque_breaches` is zero.
    pub(crate) opaque: Option<Opaque>,
}

/// Measures a drawing (`measureDrawing`). Crossings count proper interior intersections of pieces of different edges that
/// do not share a trunk. Overlaps count node pairs sharing interior area, plus edge and node pairs where a piece of the
/// edge runs through a node it does not end at. The bounds are the smallest rectangle holding every box and every point.
pub(crate) fn measure(drawing: &Drawing) -> Metrics {
    let pieces: Vec<Pieces> = drawing
        .paths
        .iter()
        .map(|path| pieces_of(&path.points))
        .collect();
    let trunks: Vec<Option<usize>> = drawing.paths.iter().map(|path| path.trunk).collect();
    let bounds = bounds_of(drawing);
    let area = bounds.width * bounds.height;
    let node_area = drawing
        .boxes
        .iter()
        .fold(0.0, |sum, rect| sum + rect.width * rect.height);
    Metrics {
        crossings: count(count_crossings(&pieces, &trunks)),
        bends: count(pieces.iter().map(|piece| piece.bends).sum()),
        edge_length: pieces.iter().fold(0.0, |sum, piece| sum + piece.length),
        area,
        density: if area > 0.0 { node_area / area } else { 0.0 },
        overlaps: count(node_overlaps(&drawing.boxes))
            + count(edge_node_overlaps(drawing, &pieces)),
        opaque_breaches: count(opaque_breaches(drawing, &pieces)),
    }
}

/// A count as a float. Counts in a drawing are far below 2^32.
fn count(n: usize) -> f64 {
    f64::from(u32::try_from(n).unwrap_or(u32::MAX))
}

/// The smallest rectangle holding every box and every point of every path; empty when there is neither.
fn bounds_of(drawing: &Drawing) -> Rect {
    let corners = drawing.boxes.iter().flat_map(|rect| {
        [
            Point {
                x: rect.x,
                y: rect.y,
            },
            Point {
                x: rect.x + rect.width,
                y: rect.y + rect.height,
            },
        ]
    });
    let points: Vec<Point> = corners
        .chain(
            drawing
                .paths
                .iter()
                .flat_map(|path| path.points.iter().copied()),
        )
        .collect();
    if points.is_empty() {
        return Rect::default();
    }
    let (min_x, max_x, min_y, max_y) = points.iter().fold(
        (
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ),
        |(min_x, max_x, min_y, max_y), p| {
            (
                min_x.min(p.x),
                max_x.max(p.x),
                min_y.min(p.y),
                max_y.max(p.y),
            )
        },
    );
    Rect {
        x: min_x,
        y: min_y,
        width: max_x - min_x,
        height: max_y - min_y,
    }
}

/// Pairs of boxes that share interior area.
fn node_overlaps(boxes: &[Rect]) -> usize {
    let mut count = 0;
    for (i, a) in boxes.iter().enumerate() {
        for b in boxes.iter().skip(i + 1) {
            if shares_area(a, b) {
                count += 1;
            }
        }
    }
    count
}

/// Whether two boxes share interior area.
fn shares_area(a: &Rect, b: &Rect) -> bool {
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/// Pairs of an edge and a node it does not end at, where a piece of the edge runs through the node.
fn edge_node_overlaps(drawing: &Drawing, pieces: &[Pieces]) -> usize {
    drawing
        .paths
        .iter()
        .zip(pieces)
        .map(|(path, piece)| {
            drawing
                .boxes
                .iter()
                .enumerate()
                .filter(|&(node, rect)| {
                    node != path.source
                        && node != path.target
                        && piece.segments.iter().any(|s| enters_box(s, rect))
                })
                .count()
        })
        .sum()
}

/// Pairs of an edge and an opaque box it may not enter, where the edge runs through the box or within the clearance of
/// its border.
fn opaque_breaches(drawing: &Drawing, pieces: &[Pieces]) -> usize {
    let Some(opaque) = &drawing.opaque else {
        return 0;
    };
    let grown: Vec<Rect> = opaque
        .boxes
        .iter()
        .map(|rect| Rect {
            x: rect.x - OPAQUE_CLEARANCE,
            y: rect.y - OPAQUE_CLEARANCE,
            width: rect.width + 2.0 * OPAQUE_CLEARANCE,
            height: rect.height + 2.0 * OPAQUE_CLEARANCE,
        })
        .collect();
    pieces
        .iter()
        .enumerate()
        .map(|(path, piece)| {
            let allowed = opaque.allowed.get(path);
            grown
                .iter()
                .enumerate()
                .filter(|&(boxed, rect)| {
                    !allowed.is_some_and(|set| set.contains(&boxed))
                        && piece.segments.iter().any(|s| enters_box(s, rect))
                })
                .count()
        })
        .sum()
}
