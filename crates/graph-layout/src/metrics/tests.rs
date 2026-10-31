//! Unit tests of the measures on hand-built drawings, and the crossing count against the brute-force oracle on random
//! small drawings. The properties through the phases are in `engine/phases/tests.rs`.

use proptest::prelude::*;

use super::{Drawing, DrawnPath, Opaque, measure};
use crate::model::{Metrics, Point, Rect};
use crate::testkit::crossings::brute_crossings;

/// A point at `(x, y)`.
fn at(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// A box of the given corner and size.
fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// A drawn path through `points`, between the boxes at `source` and `target`, with `trunk`.
fn path(points: &[(f64, f64)], source: usize, target: usize, trunk: Option<usize>) -> DrawnPath {
    DrawnPath {
        points: points.iter().map(|&(x, y)| at(x, y)).collect(),
        source,
        target,
        trunk,
    }
}

/// A drawing of `paths` among `boxes`, with no opaque boxes.
fn drawing(boxes: Vec<Rect>, paths: Vec<DrawnPath>) -> Drawing {
    Drawing {
        boxes,
        paths,
        opaque: None,
    }
}

/// The count as a float, as the measures hold it.
fn count(n: usize) -> f64 {
    f64::from(u32::try_from(n).expect("test counts fit in u32"))
}

/// A horizontal path at `y` from `x0` to `x1`, and a vertical one at `x` from `y0` to `y1`: they cross at `(x, y)` when
/// the spans reach inside each other.
fn cross_pair(trunk_a: Option<usize>, trunk_b: Option<usize>) -> Drawing {
    drawing(
        Vec::new(),
        vec![
            path(&[(0.0, 1.0), (4.0, 1.0)], 0, 0, trunk_a),
            path(&[(2.0, 0.0), (2.0, 3.0)], 0, 0, trunk_b),
        ],
    )
}

#[test]
fn two_edges_crossing_inside_both_count_once() {
    assert_eq!(measure(&cross_pair(None, None)).crossings, 1.0);
}

#[test]
fn edges_sharing_a_trunk_do_not_cross() {
    assert_eq!(measure(&cross_pair(Some(7), Some(7))).crossings, 0.0);
}

#[test]
fn an_edge_with_no_trunk_shares_one_with_no_other_edge() {
    assert_eq!(measure(&cross_pair(Some(7), None)).crossings, 1.0);
    assert_eq!(measure(&cross_pair(None, Some(7))).crossings, 1.0);
    assert_eq!(measure(&cross_pair(Some(7), Some(8))).crossings, 1.0);
}

#[test]
fn a_piece_ending_on_another_edge_does_not_cross_it() {
    // The vertical piece stops on the horizontal one: it touches, and does not run through.
    let touching = drawing(
        Vec::new(),
        vec![
            path(&[(0.0, 1.0), (4.0, 1.0)], 0, 0, None),
            path(&[(2.0, 0.0), (2.0, 1.0)], 0, 0, None),
        ],
    );
    assert_eq!(measure(&touching).crossings, 0.0);
}

#[test]
fn collinear_overlap_is_not_a_crossing() {
    let overlap = drawing(
        Vec::new(),
        vec![
            path(&[(0.0, 1.0), (4.0, 1.0)], 0, 0, None),
            path(&[(2.0, 1.0), (6.0, 1.0)], 0, 0, None),
        ],
    );
    assert_eq!(measure(&overlap).crossings, 0.0);
}

#[test]
fn a_path_does_not_cross_itself() {
    // The last leg runs up through the first, which is a self-crossing: it is not counted.
    let loop_back = drawing(
        Vec::new(),
        vec![path(
            &[(0.0, 1.0), (4.0, 1.0), (4.0, 4.0), (2.0, 4.0), (2.0, 0.0)],
            0,
            0,
            None,
        )],
    );
    assert_eq!(measure(&loop_back).crossings, 0.0);
}

#[test]
fn bends_and_length_follow_the_straight_runs() {
    let drawn = drawing(
        Vec::new(),
        vec![
            // An L: one bend, length 3 + 4.
            path(&[(0.0, 0.0), (3.0, 0.0), (3.0, 4.0)], 0, 0, None),
            // A straight run with a repeated point: the middle points are dropped, one bend, length 2 + 3.
            path(
                &[(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (2.0, 0.0), (2.0, 3.0)],
                0,
                0,
                None,
            ),
            // A diagonal step: length 5, no bend.
            path(&[(0.0, 0.0), (3.0, 4.0)], 0, 0, None),
            // A reversal is a bend: lengths 4 + 2.
            path(&[(0.0, 0.0), (4.0, 0.0), (2.0, 0.0)], 0, 0, None),
            // One point: no bend and no length.
            path(&[(1.0, 1.0)], 0, 0, None),
        ],
    );
    let measured = measure(&drawn);
    assert_eq!(measured.bends, 3.0);
    assert_eq!(measured.edge_length, 7.0 + 5.0 + 5.0 + 6.0);
}

#[test]
fn area_and_density_come_from_the_bounds() {
    // Two boxes of 4 and 1 square units, and one path that takes the bounds down to y = 4 and across to x = 6.
    let drawn = drawing(
        vec![rect(0.0, 0.0, 2.0, 2.0), rect(5.0, 0.0, 1.0, 1.0)],
        vec![path(&[(0.0, 0.0), (6.0, 0.0), (6.0, 4.0)], 0, 1, None)],
    );
    let measured = measure(&drawn);
    assert_eq!(measured.area, 24.0);
    assert_eq!(measured.density, 5.0 / 24.0);
    assert_eq!(measured.overlaps, 0.0);
}

#[test]
fn overlapping_boxes_are_one_overlap() {
    let drawn = drawing(
        vec![
            rect(0.0, 0.0, 2.0, 2.0),
            rect(1.0, 1.0, 2.0, 2.0),
            rect(5.0, 0.0, 1.0, 1.0),
        ],
        Vec::new(),
    );
    assert_eq!(measure(&drawn).overlaps, 1.0);
}

#[test]
fn an_edge_through_a_node_it_does_not_end_at_is_an_overlap() {
    // The edge runs from the box at x 0 to the box at x 10, and passes through the box at x 4.
    let drawn = drawing(
        vec![
            rect(0.0, 0.0, 2.0, 2.0),
            rect(4.0, 0.0, 2.0, 2.0),
            rect(10.0, 0.0, 2.0, 2.0),
        ],
        vec![path(&[(2.0, 1.0), (10.0, 1.0)], 0, 2, None)],
    );
    assert_eq!(measure(&drawn).overlaps, 1.0);
}

/// A drawing with one opaque box at `(2, 0)` of size 2 by 2, and the path at `y` from `x` 0 to 6 for each height, each
/// allowed the box or not.
fn opaque_drawing(ys: &[f64], allowed: bool) -> Drawing {
    let paths: Vec<DrawnPath> = ys
        .iter()
        .map(|&y| path(&[(0.0, y), (6.0, y)], 0, 0, None))
        .collect();
    let allowed_set = if allowed {
        std::iter::once(0).collect()
    } else {
        std::collections::BTreeSet::new()
    };
    Drawing {
        boxes: Vec::new(),
        opaque: Some(Opaque {
            boxes: vec![rect(2.0, 0.0, 2.0, 2.0)],
            allowed: vec![allowed_set; paths.len()],
        }),
        paths,
    }
}

#[test]
fn a_path_through_an_opaque_box_breaches_it_unless_allowed() {
    assert_eq!(measure(&opaque_drawing(&[1.0], false)).opaque_breaches, 1.0);
    assert_eq!(measure(&opaque_drawing(&[1.0], true)).opaque_breaches, 0.0);
}

#[test]
fn the_clearance_is_one_unit_outside_the_border_and_not_at_it() {
    // The box spans y 0 to 2. Its border is held one unit out: y in (-1, 3) breaches, y = -1 and y = 3 do not.
    let breaching = [2.5, -0.5];
    let clear = [3.0, -1.0];
    assert_eq!(
        measure(&opaque_drawing(&breaching, false)).opaque_breaches,
        2.0
    );
    assert_eq!(measure(&opaque_drawing(&clear, false)).opaque_breaches, 0.0);
}

#[test]
fn a_drawing_without_opaque_boxes_has_no_breaches() {
    assert_eq!(measure(&cross_pair(None, None)).opaque_breaches, 0.0);
}

#[test]
fn an_empty_drawing_measures_zero() {
    assert_eq!(
        measure(&drawing(Vec::new(), Vec::new())),
        Metrics::default()
    );
}

/// A polyline of up to five steps on a small integer grid. Each step is horizontal, vertical or diagonal, and may be of
/// zero length, so repeated points and reversals occur.
fn random_path() -> impl Strategy<Value = Vec<Point>> {
    (
        0_i32..=6,
        0_i32..=6,
        prop::collection::vec((0_u8..3, -3_i32..=3), 0..5),
    )
        .prop_map(|(x0, y0, steps)| {
            let (mut x, mut y) = (x0, y0);
            let mut points = vec![at(f64::from(x), f64::from(y))];
            for (kind, d) in steps {
                match kind {
                    0 => x += d,
                    1 => y += d,
                    _ => {
                        x += d;
                        y += d;
                    }
                }
                points.push(at(f64::from(x), f64::from(y)));
            }
            points
        })
}

proptest! {
    #[test]
    fn the_sweep_counts_the_crossings_the_brute_force_counts(
        edges in prop::collection::vec((random_path(), prop::option::of(0_usize..3)), 0..6),
    ) {
        let paths: Vec<Vec<Point>> = edges.iter().map(|(points, _)| points.clone()).collect();
        let trunks: Vec<Option<usize>> = edges.iter().map(|(_, trunk)| *trunk).collect();
        let drawn = drawing(
            Vec::new(),
            paths
                .iter()
                .zip(&trunks)
                .map(|(points, &trunk)| DrawnPath {
                    points: points.clone(),
                    source: 0,
                    target: 0,
                    trunk,
                })
                .collect(),
        );
        let measured = measure(&drawn);
        let expected = brute_crossings(&paths, &trunks);
        prop_assert!(
            measured.crossings.total_cmp(&count(expected)).is_eq(),
            "the sweep counts {} crossings, the brute force {}",
            measured.crossings,
            expected
        );
        prop_assert_eq!(measure(&drawn), measured);
        for value in [
            measured.crossings,
            measured.bends,
            measured.edge_length,
            measured.area,
            measured.density,
            measured.overlaps,
            measured.opaque_breaches,
        ] {
            prop_assert!(value.is_finite());
        }
    }
}
