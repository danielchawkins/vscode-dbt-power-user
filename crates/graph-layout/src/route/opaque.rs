//! The opaque-box gate: which opaque boxes a polyline breaches. Metrics count the same breaches, so this is the one test.

use super::{Point, Rect};

/// How far outside an opaque box a piece of an edge may run before it counts as touching the box (`opaque.ts`). A piece
/// within this distance of the border is a breach as well as one through the interior, so an edge cannot hug a wall.
pub(crate) const OPAQUE_CLEARANCE: f64 = 1.0;

/// Whether two coordinates are the same number: the test of a segment being level, which is exact by construction (the route
/// sets both ends of a level segment to one value).
pub(crate) fn same_coordinate(a: f64, b: f64) -> bool {
    a.total_cmp(&b).is_eq()
}

/// The boxes that `points` breaches: each box marked in `watched` that a segment of the polyline runs through the
/// interior of, or within `OPAQUE_CLEARANCE` of the border of. Returns their indices, in box order. A step that is neither
/// horizontal nor vertical is tested by its bounding box, so a diagonal step that may cross a box is a breach, never a pass.
pub(crate) fn breaches(points: &[Point], boxes: &[Rect], watched: &[bool]) -> Vec<usize> {
    boxes
        .iter()
        .enumerate()
        .filter(|&(b, rect)| {
            watched.get(b).copied().unwrap_or(false)
                && points.windows(2).any(|pair| enters(pair[0], pair[1], rect))
        })
        .map(|(b, _)| b)
        .collect()
}

/// Whether the segment from `a` to `b` runs through the interior of `rect` grown by the clearance. A point is a segment of
/// no length, and it counts as horizontal.
fn enters(a: Point, b: Point, rect: &Rect) -> bool {
    let left = rect.x - OPAQUE_CLEARANCE;
    let right = rect.x + rect.width + OPAQUE_CLEARANCE;
    let top = rect.y - OPAQUE_CLEARANCE;
    let bottom = rect.y + rect.height + OPAQUE_CLEARANCE;
    if same_coordinate(a.y, b.y) {
        let (from, to) = (a.x.min(b.x), a.x.max(b.x));
        a.y > top && a.y < bottom && from < right && to > left
    } else if same_coordinate(a.x, b.x) {
        let (from, to) = (a.y.min(b.y), a.y.max(b.y));
        a.x > left && a.x < right && from < bottom && to > top
    } else {
        // A diagonal step is not orthogonal, so its bounding box stands in for it: never a pass.
        let (x_from, x_to) = (a.x.min(b.x), a.x.max(b.x));
        let (y_from, y_to) = (a.y.min(b.y), a.y.max(b.y));
        x_from < right && x_to > left && y_from < bottom && y_to > top
    }
}
