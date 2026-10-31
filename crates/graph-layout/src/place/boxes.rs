//! The cluster boxes of a drawing, a port of `packages/graph-layout/src/place/boxes.ts`. One box per cluster with members;
//! each box has a left and a right edge, which are solver variables after the layered nodes, so every separation is of
//! the form `x[to] - x[from] >= gap`.
//!
//! `place` cannot read the layered graph or the model's clusters (ADR 0011, module table), so the caller states them as
//! plain data: each node's rank, its cluster path (outermost first), the ranks' order, and each cluster by index.

use std::cmp::Reverse;

use super::box_gaps::{RankMargins, rank_gaps, rank_margins};
use super::box_order::{Span, sibling_order, siblings};
use super::problem::variable;
use crate::solve::Separation;

/// Space between a box and its outermost members when its cluster sets no padding.
const DEFAULT_PADDING: f64 = 8.0;

/// A cluster as the plan reads it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ClusterSpec {
    /// The cluster's id, which names its box in the drawing.
    pub(crate) id: String,
    /// The index of the parent cluster in the same list, when it is nested in one.
    pub(crate) parent: Option<usize>,
    /// The space between the box and its members, when the cluster sets one.
    pub(crate) padding: Option<f64>,
    /// The height of the cluster's label above its box, when it has one.
    pub(crate) label_height: Option<f64>,
}

/// What the box plan is built from: the layered nodes and their clusters, the ranks' order, and the sizes and gaps of
/// the nodes.
#[derive(Debug, Clone, Copy)]
pub(crate) struct BoxInput<'a> {
    /// The number of ranks.
    pub(crate) ranks: usize,
    /// The rank of each layered node.
    pub(crate) node_ranks: &'a [usize],
    /// The clusters that contain each layered node, outermost first.
    pub(crate) paths: &'a [Vec<usize>],
    /// The nodes of each rank, from left to right.
    pub(crate) layers: &'a [Vec<usize>],
    /// Every cluster, by index.
    pub(crate) clusters: &'a [ClusterSpec],
    /// Least distance between each node's centre and its left neighbour's, as in `Problem`.
    pub(crate) gap_left: &'a [f64],
    /// Half the in-rank breadth of each layered node.
    pub(crate) half: &'a [f64],
    /// Least space between sibling boxes, and between a box and a node outside it.
    pub(crate) spacing: f64,
}

/// A cluster's box: its cluster index, its edge variables, its members and the ranks it spans.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PlanBox {
    /// The cluster's id.
    pub(crate) id: String,
    /// Index of the cluster in the input's `clusters`.
    pub(crate) cluster: usize,
    /// Index of the parent cluster, when it is nested.
    pub(crate) parent: Option<usize>,
    /// Variables of the left and right edges, after the layered nodes.
    pub(crate) left: usize,
    pub(crate) right: usize,
    /// Layered nodes inside the box, including those of nested clusters.
    pub(crate) members: Vec<usize>,
    /// The first and last rank the box spans.
    pub(crate) top: usize,
    pub(crate) bottom: usize,
    pub(crate) padding: f64,
    pub(crate) label_height: f64,
}

/// The boxes of a drawing, and the separations among the nodes and box edges that keep them apart.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BoxPlan {
    pub(crate) boxes: Vec<PlanBox>,
    /// The position in `boxes` of each cluster's box, by cluster index; `None` for a cluster with no members.
    pub(crate) by_cluster: Vec<Option<usize>>,
    /// Variables beyond the layered nodes: a left and a right edge per box.
    pub(crate) count: usize,
    /// Rank chains, box edges around members and neighbours, nesting, and the order of siblings.
    pub(crate) separations: Vec<Separation>,
    /// The least gap between each pair of adjacent ranks that keeps the drawn boxes apart. See `rank_gaps`.
    pub(crate) rank_gap: Vec<f64>,
    /// How far the boxes are drawn below and above each rank. See `rank_margins`.
    pub(crate) margins: RankMargins,
}

/// The across-rank extent of one box: its top and bottom edge.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Extent {
    pub(crate) top: f64,
    pub(crate) bottom: f64,
}

/// Plans one box per cluster that has members. A box's left and right edges are variables after the layered nodes, so
/// the separations are all of the form x[to] - x[from] >= gap. Each box keeps its members inside with its padding, and
/// each node next to a box stays outside it. A nested box keeps its parent's padding. Sibling boxes that share a rank
/// keep one order, which the ordering makes consistent, so that no two of them overlap in that rank.
pub(crate) fn plan_boxes(input: &BoxInput<'_>) -> BoxPlan {
    let boxes = boxes_of(input);
    let by_cluster = box_of_cluster(&boxes, input.clusters.len());
    let mut separations = Vec::new();
    for layer in input.layers {
        separations.extend(chain_of(layer, input.gap_left));
        for (cluster, first, last) in spans_of(layer, input.paths, input.clusters.len()) {
            if let Some(b) = by_cluster[cluster] {
                separations.extend(edges_of(input, &boxes[b], layer, first, last));
            }
        }
    }
    let order = sibling_order(input.layers, input.paths, input.clusters.len());
    separations.extend(nesting(&boxes, &by_cluster));
    let spans: Vec<Option<Span>> = by_cluster
        .iter()
        .map(|slot| {
            slot.map(|b| {
                let plan_box = &boxes[b];
                Span {
                    parent: plan_box.parent,
                    left: plan_box.left,
                    right: plan_box.right,
                    top: plan_box.top,
                    bottom: plan_box.bottom,
                }
            })
        })
        .collect();
    separations.extend(siblings(&order, &spans, input.spacing));
    BoxPlan {
        count: 2 * boxes.len(),
        rank_gap: rank_gaps(&boxes, input.ranks),
        margins: rank_margins(&boxes, input.ranks),
        by_cluster,
        boxes,
        separations,
    }
}

/// One box per cluster with members, its edges numbered after the layered nodes.
fn boxes_of(input: &BoxInput<'_>) -> Vec<PlanBox> {
    let n = input.node_ranks.len();
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); input.clusters.len()];
    for (x, path) in input.paths.iter().enumerate() {
        for &c in path {
            members[c].push(x);
        }
    }
    let mut boxes: Vec<PlanBox> = Vec::new();
    for (c, cluster) in input.clusters.iter().enumerate() {
        let nodes = &members[c];
        if nodes.is_empty() {
            continue;
        }
        let ranks: Vec<usize> = nodes.iter().map(|&x| input.node_ranks[x]).collect();
        let left = n + 2 * boxes.len();
        boxes.push(PlanBox {
            id: cluster.id.clone(),
            cluster: c,
            parent: cluster.parent,
            left,
            right: left + 1,
            members: nodes.clone(),
            top: ranks.iter().copied().min().unwrap_or(0),
            bottom: ranks.iter().copied().max().unwrap_or(0),
            padding: cluster.padding.unwrap_or(DEFAULT_PADDING),
            label_height: cluster.label_height.unwrap_or(0.0),
        });
    }
    boxes
}

/// The position in `boxes` of each cluster's box, by cluster index.
fn box_of_cluster(boxes: &[PlanBox], clusters: usize) -> Vec<Option<usize>> {
    let mut by_cluster = vec![None; clusters];
    for (i, plan_box) in boxes.iter().enumerate() {
        by_cluster[plan_box.cluster] = Some(i);
    }
    by_cluster
}

/// The rank chain of one rank: each node at least its gap beyond its left neighbour.
fn chain_of(layer: &[usize], gap_left: &[f64]) -> Vec<Separation> {
    layer
        .windows(2)
        .map(|pair| Separation {
            from: variable(pair[0]),
            to: variable(pair[1]),
            gap: gap_left[pair[1]],
        })
        .collect()
}

/// The first and last position in a rank of the members of each cluster there, in the order the clusters first appear.
fn spans_of(layer: &[usize], paths: &[Vec<usize>], clusters: usize) -> Vec<(usize, usize, usize)> {
    let mut spans: Vec<(usize, usize, usize)> = Vec::new();
    let mut at: Vec<Option<usize>> = vec![None; clusters];
    for (k, &x) in layer.iter().enumerate() {
        for &c in &paths[x] {
            match at[c] {
                None => {
                    at[c] = Some(spans.len());
                    spans.push((c, k, k));
                }
                Some(s) => spans[s].2 = k,
            }
        }
    }
    spans
}

/// The separations of one box in one rank, where its members run from position `first` to `last`: the edges sit outside
/// the outermost members by the padding, and the nodes beside the run sit outside the edges.
fn edges_of(
    input: &BoxInput<'_>,
    plan_box: &PlanBox,
    layer: &[usize],
    first: usize,
    last: usize,
) -> Vec<Separation> {
    let (half, spacing) = (input.half, input.spacing);
    let (f, l) = (layer[first], layer[last]);
    let mut out = vec![
        sep(plan_box.left, f, plan_box.padding + half[f]),
        sep(l, plan_box.right, plan_box.padding + half[l]),
    ];
    if first > 0 {
        let u = layer[first - 1];
        out.push(sep(u, plan_box.left, half[u] + spacing));
    }
    if last + 1 < layer.len() {
        let w = layer[last + 1];
        out.push(sep(plan_box.right, w, half[w] + spacing));
    }
    out
}

/// A child box lies inside its parent box, the parent's padding apart on each side.
fn nesting(boxes: &[PlanBox], by_cluster: &[Option<usize>]) -> Vec<Separation> {
    let mut out = Vec::new();
    for plan_box in boxes {
        let parent = plan_box
            .parent
            .and_then(|p| by_cluster[p])
            .map(|b| &boxes[b]);
        if let Some(parent) = parent {
            out.push(sep(parent.left, plan_box.left, parent.padding));
            out.push(sep(plan_box.right, parent.right, parent.padding));
        }
    }
    out
}

/// How many drawn boxes enclose each box, by box position.
fn depths(plan: &BoxPlan) -> Vec<usize> {
    plan.boxes
        .iter()
        .map(|plan_box| {
            let mut depth = 0;
            let mut parent = plan_box.parent;
            // A parent chain is finite in a valid plan; the bound keeps a malformed one from looping.
            while let Some(b) = parent.and_then(|p| plan.by_cluster[p]) {
                if depth == plan.boxes.len() {
                    break;
                }
                depth += 1;
                parent = plan.boxes[b].parent;
            }
            depth
        })
        .collect()
}

/// Box positions, deepest first and in input order within a depth: children before the parents that hold them.
fn deepest_first(plan: &BoxPlan) -> Vec<usize> {
    let depth = depths(plan);
    let mut order: Vec<usize> = (0..plan.boxes.len()).collect();
    order.sort_by_key(|&i| Reverse(depth[i]));
    order
}

/// `x` with every box's edges pulled in to its members and nested boxes, with its padding. The objective has no term for
/// a box edge, so the solve leaves an edge wherever its constraints let it drift; pulling it in only shrinks the box,
/// which keeps every separation of the plan. Nested boxes are tightened first, so a parent holds its children.
pub(crate) fn tighten_boxes(plan: &BoxPlan, x: &[f64], half: &[f64]) -> Vec<f64> {
    let mut out = x.to_vec();
    for i in deepest_first(plan) {
        let plan_box = &plan.boxes[i];
        let (mut left, mut right) = (f64::INFINITY, f64::NEG_INFINITY);
        for &m in &plan_box.members {
            left = left.min(x[m] - half[m] - plan_box.padding);
            right = right.max(x[m] + half[m] + plan_box.padding);
        }
        for child in plan
            .boxes
            .iter()
            .filter(|c| c.parent == Some(plan_box.cluster))
        {
            left = left.min(out[child.left] - plan_box.padding);
            right = right.max(out[child.right] + plan_box.padding);
        }
        out[plan_box.left] = left;
        out[plan_box.right] = right;
    }
    out
}

/// The starting edges of every box, from its members' starting positions, as `[left, right]` pairs flattened in box order.
pub(crate) fn initial_edges(plan: &BoxPlan, x: &[f64], half: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(2 * plan.boxes.len());
    for plan_box in &plan.boxes {
        let (mut left, mut right) = (f64::INFINITY, f64::NEG_INFINITY);
        for &m in &plan_box.members {
            left = left.min(x[m] - half[m] - plan_box.padding);
            right = right.max(x[m] + half[m] + plan_box.padding);
        }
        out.push(left);
        out.push(right);
    }
    out
}

/// The across-rank extent of each box, from the centres and half-heights of its first and last ranks, widened by its
/// padding and label; a parent is widened to hold each child box with the parent's padding.
#[cfg(test)]
pub(crate) fn across_extents(plan: &BoxPlan, centres: &[f64], rank_half: &[f64]) -> Vec<Extent> {
    let mut extent: Vec<Extent> = plan
        .boxes
        .iter()
        .map(|plan_box| Extent {
            top: centres[plan_box.top]
                - rank_half[plan_box.top]
                - plan_box.padding
                - plan_box.label_height,
            bottom: centres[plan_box.bottom] + rank_half[plan_box.bottom] + plan_box.padding,
        })
        .collect();
    for i in deepest_first(plan) {
        let Some(p) = plan.boxes[i].parent.and_then(|p| plan.by_cluster[p]) else {
            continue;
        };
        let padding = plan.boxes[p].padding;
        let (top, bottom) = (extent[i].top, extent[i].bottom);
        extent[p].top = extent[p].top.min(top - padding);
        extent[p].bottom = extent[p].bottom.max(bottom + padding);
    }
    extent
}

/// A separation `x[to] - x[from] >= gap`, from and to being node or box-edge positions.
fn sep(from: usize, to: usize, gap: f64) -> Separation {
    Separation {
        from: variable(from),
        to: variable(to),
        gap,
    }
}

/// A plan for one cluster `A` that holds nodes 0 and 2 across ranks 0 and 2 (node 1 in rank 1 is outside it), with
/// half-breadth 10 and spacing 12. Its box edges are variables 3 and 4. Shared by the tests of the plan's consumers.
#[cfg(test)]
pub(crate) fn skipping_cluster_plan(label_height: Option<f64>) -> BoxPlan {
    let node_ranks = [0, 1, 2];
    let paths = [vec![0], vec![], vec![0]];
    let layers = [vec![0], vec![1], vec![2]];
    let clusters = [ClusterSpec {
        id: "A".into(),
        parent: None,
        padding: None,
        label_height,
    }];
    plan_boxes(&BoxInput {
        ranks: 3,
        node_ranks: &node_ranks,
        paths: &paths,
        layers: &layers,
        clusters: &clusters,
        gap_left: &[0.0; 3],
        half: &[10.0; 3],
        spacing: 12.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seps(pairs: &[(usize, usize, f64)]) -> Vec<Separation> {
        pairs
            .iter()
            .map(|&(from, to, gap)| sep(from, to, gap))
            .collect()
    }

    #[test]
    fn a_box_holds_its_members_across_the_ranks_they_span() {
        let plan = skipping_cluster_plan(None);
        assert_eq!(plan.boxes.len(), 1);
        let only = &plan.boxes[0];
        assert_eq!((only.left, only.right), (3, 4));
        assert_eq!(only.members, vec![0, 2]);
        assert_eq!((only.top, only.bottom), (0, 2));
        assert_eq!(plan.count, 2);
        assert_eq!(plan.by_cluster, vec![Some(0)]);
    }

    #[test]
    fn the_edges_sit_outside_each_member_run_by_the_padding() {
        // Each rank holds one member: the left edge sits 8 + 10 before it, the right edge 8 + 10 after it.
        let plan = skipping_cluster_plan(None);
        assert_eq!(
            plan.separations,
            seps(&[(3, 0, 18.0), (0, 4, 18.0), (3, 2, 18.0), (2, 4, 18.0)])
        );
    }

    #[test]
    fn a_parent_box_holds_its_child_with_the_parent_padding() {
        // Parent P (padding 12) holds node 0 and node 1, which is in K; K holds node 1 alone, so its edges are 4 and 5.
        let node_ranks = [0, 1];
        let paths = [vec![0], vec![0, 1]];
        let layers = [vec![0], vec![1]];
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
            gap_left: &[0.0; 2],
            half: &[1.0; 2],
            spacing: 4.0,
        });
        let (p, k) = (&plan.boxes[0], &plan.boxes[1]);
        assert_eq!(k.parent, Some(0));
        assert!(plan.separations.contains(&sep(p.left, k.left, 12.0)));
        assert!(plan.separations.contains(&sep(k.right, p.right, 12.0)));
    }

    #[test]
    fn tightening_pulls_each_edge_in_to_its_members_with_the_padding() {
        // Members at 10 and 50, half-breadth 5, padding 8: the left edge is 10 - 5 - 8 = -3, the right 50 + 5 + 8 = 63.
        let plan = skipping_cluster_plan(None);
        let x = [10.0, 20.0, 50.0, 0.0, 0.0];
        let tightened = tighten_boxes(&plan, &x, &[5.0; 3]);
        assert_eq!(tightened[3], -3.0);
        assert_eq!(tightened[4], 63.0);
        assert_eq!(initial_edges(&plan, &x, &[5.0; 3]), vec![-3.0, 63.0]);
    }

    #[test]
    fn a_box_extends_across_its_first_and_last_ranks_with_padding_and_label() {
        let centres = [0.0, 40.0, 80.0];
        let rank_half = [5.0; 3];
        let plain = across_extents(&skipping_cluster_plan(None), &centres, &rank_half);
        assert_eq!(
            plain,
            vec![Extent {
                top: -13.0,
                bottom: 93.0
            }]
        );
        let labelled = across_extents(&skipping_cluster_plan(Some(20.0)), &centres, &rank_half);
        assert_eq!(
            labelled,
            vec![Extent {
                top: -33.0,
                bottom: 93.0
            }]
        );
    }
}
