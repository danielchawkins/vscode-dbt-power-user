//! The least gaps between neighbours in a rank, a port of `packages/graph-layout/src/place/gaps.ts` (`gapsLeft`). The
//! layered graph is not visible here (ADR 0011, module table), so the caller states each node as a `GapNode`.

/// What the least gap of a node needs: its breadth across the ranks, its block, and whether it is anchored (a real node
/// or a port dummy, as opposed to a chain dummy).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GapNode {
    pub(crate) breadth: f64,
    pub(crate) block: usize,
    pub(crate) anchored: bool,
}

/// Least distance between each node's centre and its left neighbour's in its rank: half of each breadth plus a spacing.
/// Two nodes of one block, and two chain dummies, keep the edge spacing. Otherwise the gap is the node spacing when both
/// sides are anchored, so the stubs of one card stay apart from the next card. A rank's leftmost node has no gap, so it
/// stays 0. The result has one entry per node.
pub(crate) fn gaps_left(
    layers: &[Vec<usize>],
    nodes: &[GapNode],
    spacing_node: f64,
    spacing_edge: f64,
) -> Vec<f64> {
    let mut gaps = vec![0.0; nodes.len()];
    for layer in layers {
        for pair in layer.windows(2) {
            let (u, v) = (nodes[pair[0]], nodes[pair[1]]);
            let gap = if u.block != v.block && u.anchored && v.anchored {
                spacing_node
            } else {
                spacing_edge
            };
            gaps[pair[1]] = f64::midpoint(u.breadth, v.breadth) + gap;
        }
    }
    gaps
}

#[cfg(test)]
mod tests {
    use super::{GapNode, gaps_left};

    fn node(breadth: f64, block: usize, anchored: bool) -> GapNode {
        GapNode {
            breadth,
            block,
            anchored,
        }
    }

    #[test]
    fn anchored_neighbours_in_different_blocks_keep_the_node_spacing() {
        let nodes = [node(10.0, 0, true), node(20.0, 1, true)];
        // (10 + 20) / 2 + 12 (node spacing)
        assert_eq!(gaps_left(&[vec![0, 1]], &nodes, 12.0, 4.0), vec![0.0, 27.0]);
    }

    #[test]
    fn a_block_or_a_chain_dummy_keeps_the_edge_spacing() {
        let same_block = [node(10.0, 7, true), node(10.0, 7, true)];
        assert_eq!(gaps_left(&[vec![0, 1]], &same_block, 12.0, 4.0)[1], 14.0);
        let dummies = [node(2.0, 0, false), node(2.0, 1, true)];
        assert_eq!(gaps_left(&[vec![0, 1]], &dummies, 12.0, 4.0)[1], 6.0);
    }

    #[test]
    fn a_rank_leftmost_node_has_no_gap_and_every_node_is_covered() {
        let nodes = [node(4.0, 0, true), node(4.0, 1, true), node(4.0, 2, true)];
        let gaps = gaps_left(&[vec![2, 0], vec![1]], &nodes, 12.0, 4.0);
        assert_eq!(gaps, vec![16.0, 0.0, 0.0]);
    }
}
