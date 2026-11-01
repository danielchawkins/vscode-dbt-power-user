//! The crossings of polylines counted pair by pair, from the definition, to check the sweep in `metrics` against. A
//! horizontal step of one path crosses a vertical step of another at a point strictly inside both, and the two paths do
//! not share a trunk. Nothing is joined: a point lies inside a run of steps when the steps cover the unit on each side of
//! it, so steps that only touch make one run, as the joined pieces of `metrics` do.

use std::collections::BTreeSet;

use crate::model::Point;

/// An axis-aligned step of a polyline: `from` and `to` are its ends along the varying axis, `from` < `to`.
struct Step {
    horizontal: bool,
    fixed: f64,
    from: f64,
    to: f64,
}

/// The crossings of the routed `paths` of the router, whose trunks are `trunks`, counted as `brute_crossings` counts them.
pub(crate) fn brute_crossings_of_routes(
    paths: &[Vec<crate::route::Point>],
    trunks: &[Option<usize>],
) -> usize {
    let model: Vec<Vec<Point>> = paths
        .iter()
        .map(|path| path.iter().map(|p| Point { x: p.x, y: p.y }).collect())
        .collect();
    brute_crossings(&model, trunks)
}

/// The crossings of `paths`, whose trunks are `trunks` (aligned with `paths`; `None` shares with no path). It is
/// quadratic in the paths and in their steps, and it shares no code with the sweep.
pub(crate) fn brute_crossings(paths: &[Vec<Point>], trunks: &[Option<usize>]) -> usize {
    let steps: Vec<Vec<Step>> = paths.iter().map(|path| steps_of(path)).collect();
    let mut total = 0;
    for (i, a) in steps.iter().enumerate() {
        for (j, b) in steps.iter().enumerate() {
            let trunk_i = trunks.get(i).copied().flatten();
            if i == j || (trunk_i.is_some() && trunk_i == trunks.get(j).copied().flatten()) {
                continue;
            }
            let mut points = BTreeSet::new();
            for h in a.iter().filter(|s| s.horizontal) {
                for v in b.iter().filter(|s| !s.horizontal) {
                    let (x, y) = (v.fixed, h.fixed);
                    if strictly_inside(a, true, y, x) && strictly_inside(b, false, x, y) {
                        points.insert((key(x), key(y)));
                    }
                }
            }
            total += points.len();
        }
    }
    total
}

/// The axis-aligned steps of a polyline. A zero-length step and a diagonal step are not steps.
fn steps_of(points: &[Point]) -> Vec<Step> {
    points
        .windows(2)
        .filter_map(|pair| {
            let (a, b) = (pair[0], pair[1]);
            if (a.y - b.y) == 0.0 && (a.x - b.x) != 0.0 {
                Some(Step {
                    horizontal: true,
                    fixed: a.y,
                    from: a.x.min(b.x),
                    to: a.x.max(b.x),
                })
            } else if (a.x - b.x) == 0.0 && (a.y - b.y) != 0.0 {
                Some(Step {
                    horizontal: false,
                    fixed: a.x,
                    from: a.y.min(b.y),
                    to: a.y.max(b.y),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Whether the steps of one orientation on the line `line` cover `at` strictly inside: some step reaches it from the
/// left and some step reaches it from the right.
fn strictly_inside(steps: &[Step], horizontal: bool, line: f64, at: f64) -> bool {
    let on_line = |s: &&Step| s.horizontal == horizontal && (s.fixed - line) == 0.0;
    let from_left = steps
        .iter()
        .filter(on_line)
        .any(|s| s.from < at && s.to >= at);
    let from_right = steps
        .iter()
        .filter(on_line)
        .any(|s| s.from <= at && s.to > at);
    from_left && from_right
}

/// A coordinate as a key that orders and compares as the number does; `-0.0` and `0.0` have one key.
fn key(value: f64) -> u64 {
    (value + 0.0).to_bits()
}
