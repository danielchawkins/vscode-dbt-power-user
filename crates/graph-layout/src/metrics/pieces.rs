//! The pieces of one drawn polyline: its axis-aligned segments, its length and its bends (`drawingSegments.ts`). Repeated
//! points are dropped and a point that carries on a straight run is not a segment end. Segments of one line that touch or
//! overlap are joined, so a point of a line lies in at most one segment. A diagonal step adds length and bends but no
//! segment.

use crate::model::{Point, Rect};

/// An axis-aligned piece of a polyline. `from` and `to` are its ends along the varying axis, `from` < `to`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Segment {
    /// Whether the piece runs along x, so that `fixed` is a y; otherwise it runs along y and `fixed` is an x.
    pub(super) horizontal: bool,
    /// The coordinate the piece holds still.
    pub(super) fixed: f64,
    /// The lower end along the varying axis.
    pub(super) from: f64,
    /// The upper end along the varying axis.
    pub(super) to: f64,
}

/// The pieces of one drawn polyline.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Pieces {
    /// The joined axis-aligned segments.
    pub(super) segments: Vec<Segment>,
    /// Sum of the lengths of the steps.
    pub(super) length: f64,
    /// Points left after the straight runs are dropped, less the two ends.
    pub(super) bends: usize,
}

/// Whether two coordinates are the same number. Coordinates pass through `canonical` first, so `-0.0` and `0.0` agree.
pub(super) fn same(a: f64, b: f64) -> bool {
    a.total_cmp(&b).is_eq()
}

/// `value`, with `-0.0` made `0.0`, so that `same` treats them as one number.
fn canonical(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

/// Splits a polyline into its pieces (`piecesOf`).
pub(super) fn pieces_of(raw: &[Point]) -> Pieces {
    let points = straight_runs(raw);
    let mut segments = Vec::new();
    let mut length = 0.0;
    for pair in points.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        length += (dx * dx + dy * dy).sqrt();
        if let Some(segment) = segment_of(a, b) {
            segments.push(segment);
        }
    }
    Pieces {
        segments: join_on_lines(segments),
        length,
        bends: points.len().saturating_sub(2),
    }
}

/// Drops repeated points, then drops each point that carries on in the direction of the run before it.
fn straight_runs(raw: &[Point]) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::new();
    for &p in raw {
        let p = Point {
            x: canonical(p.x),
            y: canonical(p.y),
        };
        if out
            .last()
            .is_some_and(|&last| same(last.x, p.x) && same(last.y, p.y))
        {
            continue;
        }
        let continues = match (out.iter().rev().nth(1), out.last()) {
            (Some(&before), Some(&last)) => continues_run(before, last, p),
            _ => false,
        };
        if continues {
            if let Some(last) = out.last_mut() {
                *last = p;
            }
        } else {
            out.push(p);
        }
    }
    out
}

/// Whether `c` lies ahead of `b` on the line from `a`: collinear, and not a reversal.
fn continues_run(a: Point, b: Point, c: Point) -> bool {
    let (ux, uy) = (b.x - a.x, b.y - a.y);
    let (vx, vy) = (c.x - b.x, c.y - b.y);
    ux * vy - uy * vx == 0.0 && ux * vx + uy * vy > 0.0
}

/// The segment of a step that is horizontal or vertical; a diagonal step has none.
fn segment_of(a: Point, b: Point) -> Option<Segment> {
    if same(a.y, b.y) {
        Some(Segment {
            horizontal: true,
            fixed: a.y,
            from: a.x.min(b.x),
            to: a.x.max(b.x),
        })
    } else if same(a.x, b.x) {
        Some(Segment {
            horizontal: false,
            fixed: a.x,
            from: a.y.min(b.y),
            to: a.y.max(b.y),
        })
    } else {
        None
    }
}

/// Joins the segments of one line that overlap or touch, in the order of their lines.
fn join_on_lines(mut segments: Vec<Segment>) -> Vec<Segment> {
    segments.sort_by(|a, b| {
        a.horizontal
            .cmp(&b.horizontal)
            .then(a.fixed.total_cmp(&b.fixed))
            .then(a.from.total_cmp(&b.from))
    });
    let mut joined: Vec<Segment> = Vec::new();
    for s in segments {
        match joined.last_mut() {
            Some(last)
                if last.horizontal == s.horizontal
                    && same(last.fixed, s.fixed)
                    && s.from <= last.to =>
            {
                last.to = last.to.max(s.to);
            }
            _ => joined.push(s),
        }
    }
    joined
}

/// Whether a segment runs through the interior of a box. Touching its edges does not count.
pub(super) fn enters_box(s: &Segment, rect: &Rect) -> bool {
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    if s.horizontal {
        s.fixed > rect.y && s.fixed < bottom && s.from < right && s.to > rect.x
    } else {
        s.fixed > rect.x && s.fixed < right && s.from < bottom && s.to > rect.y
    }
}
