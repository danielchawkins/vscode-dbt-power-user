//! Vertical alignment and type 1 conflicts of Brandes and Köpf (GD 2001, section 2), a port of
//! `packages/graph-layout/src/place/bkAlignment.ts`. Each node joins the block of one median neighbour in the rank it is
//! aligned to, so the blocks are straight runs of segments; `compaction` then places the blocks.

use super::problem::Problem;

/// One pass's view of the ranks: nodes from left to right, each node's index and its left neighbour, and the gap.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Frame {
    /// Nodes of each rank in this pass's order (reversed for a mirrored pass).
    pub(crate) layers: Vec<Vec<usize>>,
    /// Index of each node in its rank.
    pub(crate) pos: Vec<usize>,
    /// Left neighbour of each node in its rank, or `None` at the left end.
    pub(crate) left: Vec<Option<usize>>,
    /// Least distance between each node's centre and its left neighbour's.
    pub(crate) gap: Vec<f64>,
}

/// The block of each node after vertical alignment: its root, and the next node of its block in a cycle.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Blocks {
    pub(crate) root: Vec<usize>,
    pub(crate) align: Vec<usize>,
}

/// A node at the other end of a link, and the link itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Neighbour {
    pub(crate) node: usize,
    pub(crate) link: usize,
}

/// What a vertical alignment pass needs besides the frame: the neighbours it may join and the links it must not join.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Pass<'a> {
    /// Per node, the neighbours on the side the pass aligns to.
    pub(crate) adjacent: &'a [Vec<Neighbour>],
    /// Links that may not be aligned (type 1 conflicts), by link index.
    pub(crate) conflict: &'a [bool],
    /// The ranks are processed from the top down, aligning each node to its upper neighbours.
    pub(crate) from_above: bool,
}

/// The upper and lower neighbours of each node. Links join adjacent ranks only.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Adjacency {
    pub(crate) above: Vec<Vec<Neighbour>>,
    pub(crate) below: Vec<Vec<Neighbour>>,
}

/// The upper and lower neighbours of each node, from the links, in link order.
pub(crate) fn adjacency(problem: &Problem) -> Adjacency {
    let n = problem.dummy.len();
    let mut above: Vec<Vec<Neighbour>> = vec![Vec::new(); n];
    let mut below: Vec<Vec<Neighbour>> = vec![Vec::new(); n];
    for (link, segment) in problem.links.iter().enumerate() {
        above[segment.bottom].push(Neighbour {
            node: segment.top,
            link,
        });
        below[segment.top].push(Neighbour {
            node: segment.bottom,
            link,
        });
    }
    Adjacency { above, below }
}

/// Whether two links cross: their upper ends and their lower ends are in opposite orders.
fn crosses(top_a: usize, top_b: usize, bottom_a: usize, bottom_b: usize) -> bool {
    use std::cmp::Ordering::{Greater, Less};
    matches!(
        (top_a.cmp(&top_b), bottom_a.cmp(&bottom_b)),
        (Less, Greater) | (Greater, Less)
    )
}

/// Marks the type 1 conflicts of Brandes and Köpf: a link between two real nodes that crosses a link between two dummies
/// is not aligned, so that the long edges that the dummies carry keep their straight runs. The result is per link; a
/// conflicting link is `true`.
pub(crate) fn type_one_conflicts(problem: &Problem) -> Vec<bool> {
    let n = problem.dummy.len();
    let mut pos = vec![0; n];
    let mut rank = vec![0; n];
    for (r, layer) in problem.layers.iter().enumerate() {
        for (k, &v) in layer.iter().enumerate() {
            pos[v] = k;
            rank[v] = r;
        }
    }
    let mut by_rank: Vec<Vec<usize>> = vec![Vec::new(); problem.layers.len()];
    for (s, segment) in problem.links.iter().enumerate() {
        by_rank[rank[segment.top]].push(s);
    }
    let inner = |s: usize| {
        let segment = problem.links[s];
        problem.dummy[segment.top] && problem.dummy[segment.bottom]
    };
    let mut conflict = vec![false; problem.links.len()];
    for group in &by_rank {
        let outer: Vec<usize> = group.iter().copied().filter(|&s| !inner(s)).collect();
        for &a in group.iter().filter(|&&s| inner(s)) {
            let la = problem.links[a];
            for &b in &outer {
                let lb = problem.links[b];
                if crosses(pos[la.top], pos[lb.top], pos[la.bottom], pos[lb.bottom]) {
                    conflict[b] = true;
                }
            }
        }
    }
    conflict
}

/// The ranks as one horizontal pass sees them. A mirrored pass reads each rank from right to left, so its coordinates
/// come out mirrored and must be negated.
pub(crate) fn frame_of(problem: &Problem, mirror: bool) -> Frame {
    let n = problem.dummy.len();
    let layers: Vec<Vec<usize>> = problem
        .layers
        .iter()
        .map(|layer| {
            let mut ordered = layer.clone();
            if mirror {
                ordered.reverse();
            }
            ordered
        })
        .collect();
    let mut pos = vec![0; n];
    let mut left = vec![None; n];
    let mut gap = vec![0.0; n];
    for layer in &layers {
        for (k, &v) in layer.iter().enumerate() {
            pos[v] = k;
            if k > 0 {
                let u = layer[k - 1];
                left[v] = Some(u);
                // Mirrored, the left neighbour was the right one, so the gap is that neighbour's own left gap.
                gap[v] = if mirror {
                    problem.gap_left[u]
                } else {
                    problem.gap_left[v]
                };
            }
        }
    }
    Frame {
        layers,
        pos,
        left,
        gap,
    }
}

/// Vertical alignment (Brandes and Köpf, section 2.2): each node joins the block of one median neighbour in the rank it is
/// aligned to, when that neighbour is free, the link is not in conflict, and the joined neighbours keep their
/// left-to-right order.
pub(crate) fn align_blocks(frame: &Frame, pass: &Pass<'_>) -> Blocks {
    let n = frame.pos.len();
    let mut root: Vec<usize> = (0..n).collect();
    let mut align = root.clone();
    let ranks = frame.layers.len();
    let order: Vec<usize> = if pass.from_above {
        (1..ranks).collect()
    } else {
        (0..ranks.saturating_sub(1)).rev().collect()
    };
    for r in order {
        let mut reach: Option<usize> = None;
        for &v in &frame.layers[r] {
            for nb in median_neighbours(&pass.adjacent[v], &frame.pos) {
                if align[v] == v
                    && !pass.conflict[nb.link]
                    && reach.is_none_or(|p| p < frame.pos[nb.node])
                {
                    align[nb.node] = v;
                    root[v] = root[nb.node];
                    align[v] = root[v];
                    reach = Some(frame.pos[nb.node]);
                }
            }
        }
    }
    Blocks { root, align }
}

/// The one or two median neighbours of a node, by position in their rank, in ascending order. The sort is stable, so
/// neighbours at one position keep their link order.
fn median_neighbours(nbrs: &[Neighbour], pos: &[usize]) -> Vec<Neighbour> {
    let mut sorted = nbrs.to_vec();
    sorted.sort_by_key(|nb| pos[nb.node]);
    let d = sorted.len();
    match d {
        0 => Vec::new(),
        _ if d % 2 == 1 => vec![sorted[(d - 1) / 2]],
        _ => vec![sorted[d / 2 - 1], sorted[d / 2]],
    }
}

#[cfg(test)]
mod tests {
    use super::super::problem::Link;
    use super::*;

    fn span(from: usize, to: usize) -> Vec<usize> {
        (from..to).collect()
    }

    #[test]
    fn a_link_from_a_real_node_across_a_dummy_link_is_a_type_one_conflict() {
        // Ranks: [0, 1] over [2, 3]. Node 0 is real and node 1 a dummy. Link 0 joins the real node 0 to the real node 3;
        // link 1 joins the dummy 1 to the dummy 2. The top order is (0, 1) and the bottom order is (2, 3), so the dummy
        // link runs from position 1 to position 0 and the real link from 0 to 1: they cross. The dummy-dummy link is
        // inner and the real-real link outer, so the outer link is the one marked.
        let problem = Problem {
            layers: vec![vec![0, 1], vec![2, 3]],
            gap_left: vec![0.0; 4],
            dummy: vec![false, true, true, false],
            links: vec![Link::new(0, 3), Link::new(1, 2)],
            pulls: Vec::new(),
            extra: None,
        };
        assert_eq!(type_one_conflicts(&problem), vec![true, false]);
    }

    #[test]
    fn frames_mirror_the_ranks_and_keep_each_gap_on_its_own_node() {
        let problem = Problem {
            layers: vec![span(0, 3)],
            gap_left: vec![0.0, 5.0, 7.0],
            dummy: vec![false; 3],
            links: Vec::new(),
            pulls: Vec::new(),
            extra: None,
        };
        let plain = frame_of(&problem, false);
        assert_eq!(plain.left, vec![None, Some(0), Some(1)]);
        assert_eq!(plain.gap, vec![0.0, 5.0, 7.0]);
        let mirrored = frame_of(&problem, true);
        assert_eq!(mirrored.layers, vec![vec![2, 1, 0]]);
        assert_eq!(mirrored.left, vec![Some(1), Some(2), None]);
        // Mirrored, node 1's left neighbour is node 2, and the gap is node 2's own left gap, 7; node 0's is node 1's, 5.
        assert_eq!(mirrored.gap, vec![5.0, 7.0, 0.0]);
    }

    #[test]
    fn a_chain_of_links_aligns_into_one_block() {
        let problem = Problem {
            layers: vec![vec![0], vec![1], vec![2]],
            gap_left: vec![0.0; 3],
            dummy: vec![false; 3],
            links: vec![Link::new(0, 1), Link::new(1, 2)],
            pulls: Vec::new(),
            extra: None,
        };
        let adjacency = adjacency(&problem);
        let conflict = type_one_conflicts(&problem);
        let frame = frame_of(&problem, false);
        let blocks = align_blocks(
            &frame,
            &Pass {
                adjacent: &adjacency.above,
                conflict: &conflict,
                from_above: true,
            },
        );
        assert_eq!(blocks.root, vec![0, 0, 0]);
    }
}
