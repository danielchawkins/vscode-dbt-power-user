//! The rectangle of each cluster box, a port of `packages/graph-layout/src/place/boxRects.ts`. Routing re-stacks the ranks and
//! recomputes the boxes from the frame, so the frame carries the box edges along the ranks.

use super::boxes::{BoxPlan, across_extents};

/// The cluster boxes of a placement: their plan, and each box's edge along the ranks in the drawing's frame.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BoxFrame {
    pub(crate) plan: BoxPlan,
    /// Left and right edge of each box, as `[left, right]` pairs flattened in box order, in the drawing's frame.
    pub(crate) edges: Vec<f64>,
    /// Top and bottom edge of each box across the ranks, as `[top, bottom]` pairs, when the across axis is solved per
    /// node (`ranks: "levels"`). Absent when the boxes take their extent from the rows.
    pub(crate) across: Option<Vec<f64>>,
    /// Whether the ranks run down the drawing.
    pub(crate) down: bool,
}

/// A cluster box's rectangle in the drawing, named by its cluster id.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BoxRect {
    pub(crate) id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// The rectangle of each cluster box, in box order. Its edges along the ranks come from the frame; its extent across the
/// ranks comes from the frame's solved edges when it has them, and otherwise from the ranks' centres and half-heights,
/// so that a re-stacked drawing gets its boxes recomputed.
pub(crate) fn box_rects(frame: &BoxFrame, centres: &[f64], rank_half: &[f64]) -> Vec<BoxRect> {
    let extents = across_extents(&frame.plan, centres, rank_half);
    frame
        .plan
        .boxes
        .iter()
        .enumerate()
        .map(|(b, plan_box)| {
            let along = (frame.edges[2 * b], frame.edges[2 * b + 1]);
            let across = match &frame.across {
                None => (extents[b].top, extents[b].bottom),
                Some(solved) => (solved[2 * b], solved[2 * b + 1]),
            };
            rect_of(frame.down, along, across, plan_box.id.clone())
        })
        .collect()
}

/// A rectangle from its extents along the rank direction and across it; `down` ranks run top to bottom.
fn rect_of(down: bool, along: (f64, f64), across: (f64, f64), id: String) -> BoxRect {
    let (a0, a1) = along;
    let (c0, c1) = across;
    if down {
        BoxRect {
            id,
            x: a0,
            y: c0,
            width: a1 - a0,
            height: c1 - c0,
        }
    } else {
        BoxRect {
            id,
            x: c0,
            y: a0,
            width: c1 - c0,
            height: a1 - a0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::boxes::skipping_cluster_plan;
    use super::{BoxFrame, BoxRect, box_rects};

    /// The frame of the skipping-cluster plan, whose box spans x from -3 to 63 once tightened.
    fn frame(down: bool, across: Option<Vec<f64>>) -> BoxFrame {
        BoxFrame {
            plan: skipping_cluster_plan(None),
            edges: vec![-3.0, 63.0],
            across,
            down,
        }
    }

    #[test]
    fn a_box_takes_its_extent_across_from_the_ranks_when_the_frame_has_none() {
        let centres = [0.0, 40.0, 80.0];
        let rects = box_rects(&frame(true, None), &centres, &[5.0; 3]);
        assert_eq!(
            rects,
            vec![BoxRect {
                id: "A".into(),
                x: -3.0,
                y: -13.0,
                width: 66.0,
                height: 106.0,
            }]
        );
    }

    #[test]
    fn a_solved_across_extent_wins_and_ranks_running_right_swap_the_axes() {
        let rects = box_rects(&frame(false, Some(vec![1.0, 2.0])), &[0.0; 3], &[5.0; 3]);
        assert_eq!(
            rects,
            vec![BoxRect {
                id: "A".into(),
                x: 1.0,
                y: -3.0,
                width: 1.0,
                height: 66.0,
            }]
        );
    }
}
