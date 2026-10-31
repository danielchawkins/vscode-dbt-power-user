//! The margins of cluster boxes, a port of `packages/graph-layout/src/place/boxGaps.ts`: how far each box is drawn beyond its
//! first and last rank, and the least gap between adjacent ranks that keeps the drawn boxes apart.

use super::boxes::PlanBox;

/// How far a box is drawn above its first rank and below its last, beyond the rank itself.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Margins {
    pub(crate) above: f64,
    pub(crate) below: f64,
}

/// The margins at each rank: `below[r]` past rank `r`'s bottom, and `above[r]` before its top.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RankMargins {
    pub(crate) below: Vec<f64>,
    pub(crate) above: Vec<f64>,
}

/// How far the boxes are drawn beyond each rank: `below[r]` past rank `r`'s bottom by the boxes ending there, and
/// `above[r]` before its top by the boxes starting there. A box is drawn past its first rank by its padding and label,
/// and past its last rank by its padding.
pub(crate) fn rank_margins(boxes: &[PlanBox], ranks: usize) -> RankMargins {
    let mut below = vec![0.0_f64; ranks];
    let mut above = vec![0.0_f64; ranks];
    for (i, plan_box) in boxes.iter().enumerate() {
        let margins = margins_of(boxes, i);
        below[plan_box.bottom] = below[plan_box.bottom].max(margins.below);
        above[plan_box.top] = above[plan_box.top].max(margins.above);
    }
    RankMargins { below, above }
}

/// The least gap between each pair of adjacent ranks that keeps the drawn boxes apart: the bottom margins of the boxes
/// ending at rank `r` and the top margins of those starting at `r + 1`. Gap `r` lies between ranks `r` and `r + 1`.
pub(crate) fn rank_gaps(boxes: &[PlanBox], ranks: usize) -> Vec<f64> {
    let RankMargins { below, above } = rank_margins(boxes, ranks);
    (0..ranks.saturating_sub(1))
        .map(|r| below[r] + above[r + 1])
        .collect()
}

/// A box's margins with those of its nested boxes: a parent holds each child with the parent's padding. A child spans
/// ranks inside its parent's, so this bounds how far any child is drawn.
fn margins_of(boxes: &[PlanBox], i: usize) -> Margins {
    let plan_box = &boxes[i];
    let mut above = plan_box.padding + plan_box.label_height;
    let mut below = plan_box.padding;
    for (j, child) in boxes.iter().enumerate() {
        if child.parent == Some(plan_box.cluster) {
            let inner = margins_of(boxes, j);
            above = above.max(inner.above + plan_box.padding);
            below = below.max(inner.below + plan_box.padding);
        }
    }
    Margins { above, below }
}

#[cfg(test)]
mod tests {
    use super::super::boxes::{BoxInput, ClusterSpec, plan_boxes};
    use super::{rank_gaps, rank_margins};

    /// Two boxes in ranks 0 to 1: `A` with padding 30 and a label of 20, and `B` with the default padding.
    fn two_boxes() -> Vec<super::super::boxes::PlanBox> {
        let node_ranks = [0, 1];
        let paths = [vec![0], vec![1]];
        let layers = [vec![0], vec![1]];
        let clusters = [
            ClusterSpec {
                id: "A".into(),
                parent: None,
                padding: Some(30.0),
                label_height: Some(20.0),
            },
            ClusterSpec {
                id: "B".into(),
                parent: None,
                padding: None,
                label_height: None,
            },
        ];
        let plan = plan_boxes(&BoxInput {
            ranks: 2,
            node_ranks: &node_ranks,
            paths: &paths,
            layers: &layers,
            clusters: &clusters,
            gap_left: &[0.0, 0.0],
            half: &[1.0, 1.0],
            spacing: 4.0,
        });
        plan.boxes
    }

    #[test]
    fn a_box_is_drawn_past_its_first_rank_by_padding_and_label_and_past_its_last_by_padding() {
        let boxes = two_boxes();
        let margins = rank_margins(&boxes[..1], 2);
        assert_eq!(margins.above, vec![50.0, 0.0]);
        assert_eq!(margins.below, vec![30.0, 0.0]);
    }

    #[test]
    fn the_gap_between_ranks_holds_the_box_ending_above_and_the_one_starting_below() {
        let boxes = two_boxes();
        // Box A ends at rank 0 with its padding below (30) and box B starts at rank 1 with its own top margin (8 + 0).
        assert_eq!(rank_gaps(&boxes, 2), vec![30.0 + 8.0]);
    }

    #[test]
    fn a_parent_holds_each_child_with_its_padding() {
        // Parent P (padding 12) spans ranks 0 to 2; child K (padding 4) sits in rank 1 alone.
        let node_ranks = [0, 1, 2];
        let paths = [vec![0], vec![0, 1], vec![0]];
        let layers = [vec![0], vec![1], vec![2]];
        let clusters = [
            ClusterSpec {
                id: "P".into(),
                parent: None,
                padding: Some(12.0),
                label_height: None,
            },
            ClusterSpec {
                id: "K".into(),
                parent: Some(0),
                padding: Some(4.0),
                label_height: None,
            },
        ];
        let plan = plan_boxes(&BoxInput {
            ranks: 3,
            node_ranks: &node_ranks,
            paths: &paths,
            layers: &layers,
            clusters: &clusters,
            gap_left: &[0.0; 3],
            half: &[1.0; 3],
            spacing: 4.0,
        });
        // The child's own margins are 4 each side, at rank 1. The parent's are the child's plus the parent's 12 (16),
        // above rank 0 and below rank 2.
        let margins = rank_margins(&plan.boxes, 3);
        assert_eq!(margins.above, vec![16.0, 4.0, 0.0]);
        assert_eq!(margins.below, vec![0.0, 4.0, 16.0]);
    }
}
