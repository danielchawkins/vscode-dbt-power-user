//! The hint translation, a port of `packages/graph-layout/src/place/hints.ts`. A hint is a node's previous top-left corner;
//! the model is not visible here (ADR 0011, module table), so the caller looks up each node's hint and states it.

/// A previous top-left corner, in the drawing's frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Hint {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

/// One node as the hint fit reads it: its hint if it has one (absent for a dummy or an unhinted node), its half-extent
/// along the axis, and its position along the axis.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct HintedNode {
    pub(crate) hint: Option<Hint>,
    pub(crate) half: f64,
    pub(crate) x: f64,
}

/// The corner a hint gives along one axis. `in_rank` selects the axis the ranks run along; `down` is true when ranks run
/// down. A hint gives the corner, so a centre adds half the node's extent along that axis.
pub(crate) fn hint_corner(hint: Hint, down: bool, in_rank: bool) -> f64 {
    if down == in_rank { hint.x } else { hint.y }
}

/// The translation that best fits the hinted nodes to their previous corners along one axis: the mean of
/// (hint corner + half - x). Translation is free, so it applies whatever the effort or stability. `None` when no node is
/// hinted.
pub(crate) fn hint_shift(nodes: &[HintedNode], down: bool, in_rank: bool) -> Option<f64> {
    let mut sum = 0.0;
    let mut count = 0_u32;
    for node in nodes {
        if let Some(hint) = node.hint {
            sum += hint_corner(hint, down, in_rank) + node.half - node.x;
            count += 1;
        }
    }
    (count > 0).then(|| sum / f64::from(count))
}

#[cfg(test)]
mod tests {
    use super::{Hint, HintedNode, hint_corner, hint_shift};

    fn hinted(hint: Option<(f64, f64)>, half: f64, x: f64) -> HintedNode {
        HintedNode {
            hint: hint.map(|(x, y)| Hint { x, y }),
            half,
            x,
        }
    }

    #[test]
    fn the_corner_is_x_for_the_rank_axis_going_down_and_y_across_it() {
        let hint = Hint { x: 3.0, y: 7.0 };
        assert_eq!(hint_corner(hint, true, true), 3.0);
        assert_eq!(hint_corner(hint, true, false), 7.0);
        assert_eq!(hint_corner(hint, false, true), 7.0);
        assert_eq!(hint_corner(hint, false, false), 3.0);
    }

    #[test]
    fn the_shift_is_the_mean_over_the_hinted_nodes_only() {
        // Corner + half - x: (10 + 5 - 12) = 3 and (20 + 5 - 22) = 3; the unhinted node does not count.
        let nodes = [
            hinted(Some((10.0, 0.0)), 5.0, 12.0),
            hinted(None, 5.0, 100.0),
            hinted(Some((20.0, 0.0)), 5.0, 22.0),
        ];
        assert_eq!(hint_shift(&nodes, true, true), Some(3.0));
    }

    #[test]
    fn no_hinted_node_gives_no_shift() {
        let nodes = [hinted(None, 5.0, 1.0)];
        assert_eq!(hint_shift(&nodes, true, true), None);
        assert_eq!(hint_shift(&[], true, true), None);
    }
}
