//! The polyline of one edge: from its source end down to a track, across it, and on to the next stop, run by run.

use super::stack::Stacked;
use super::{Point, Stop, count, frame};

/// The polyline of an edge through its `stops` (from the source end to the target end), in the drawing's frame. `tracks`
/// gives each run its track (`None` for a run with no horizontal piece). Repeated points, and points that lie straight
/// on the line through their neighbours, are dropped, so only the bends remain.
pub(super) fn polyline(
    stops: &[Stop],
    tracks: &[Option<usize>],
    stacked: &Stacked,
    edge: f64,
    down: bool,
) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::new();
    for (k, pair) in stops.windows(2).enumerate() {
        let (from, to) = (pair[0], pair[1]);
        let flat = from.rank == to.rank;
        let toward_lower = to.rank > from.rank;
        // A run leaves its upper stop at the bottom of the node, or at its top when it goes up; it enters the lower stop
        // at its top, or at its bottom when it goes up or is flat. A dummy has no half, so both sides meet at its centre.
        let leave = if flat || toward_lower {
            from.half
        } else {
            -from.half
        };
        let arrive = if flat || !toward_lower {
            to.half
        } else {
            -to.half
        };
        push(
            &mut out,
            frame(down, from.along, stacked.centre(from.rank) + leave),
        );
        if let Some(Some(track)) = tracks.get(k) {
            let band = from.rank.min(to.rank);
            let y = stacked.band_top(band) + edge * count(track + 1);
            push(&mut out, frame(down, from.along, y));
            push(&mut out, frame(down, to.along, y));
        }
        push(
            &mut out,
            frame(down, to.along, stacked.centre(to.rank) + arrive),
        );
    }
    out
}

/// Appends `p` to `out`, unless it repeats the last point. When `p` carries on in the direction the last two points
/// went, the last point is replaced by `p`, so a straight run keeps only its ends. A reversal is kept as a bend.
pub(super) fn push(out: &mut Vec<Point>, p: Point) {
    let Some(&last) = out.last() else {
        out.push(p);
        return;
    };
    if last == p {
        return;
    }
    if let Some(&before) = out.iter().rev().nth(1) {
        let (ux, uy) = (last.x - before.x, last.y - before.y);
        let (vx, vy) = (p.x - last.x, p.y - last.y);
        let collinear = ux * vy - uy * vx == 0.0;
        if collinear && ux * vx + uy * vy > 0.0 {
            if let Some(end) = out.last_mut() {
                *end = p;
            }
            return;
        }
    }
    out.push(p);
}
