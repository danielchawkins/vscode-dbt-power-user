//! The across separations of the cluster boxes for `ranks: "levels"`, a port of
//! `packages/graph-layout/src/place/levelBoxes.ts`. They mirror the in-rank ones: each box's top edge sits above its
//! members and its bottom edge below them, a nested box keeps its parent's padding, sibling boxes that share no rank
//! keep one order, and a node of another rank stays beyond the box on its side when the two overlap in-rank.

use std::collections::BTreeSet;

use super::boxes::BoxPlan;
use super::problem::variable;
use crate::solve::Separation;

/// What the across separations of the cluster boxes are drawn from.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LevelBoxInput<'a> {
    /// The box plan: the boxes, their members, padding and label, and the in-rank edge variables.
    pub(crate) plan: &'a BoxPlan,
    /// Each layered node's rank.
    pub(crate) ranks: &'a [usize],
    /// Every variable's in-rank position: the layered nodes, then each box's left and right edge.
    pub(crate) in_rank: &'a [f64],
    /// Half the in-rank extent of each layered node.
    pub(crate) half_in: &'a [f64],
    /// Half the across extent of each layered node.
    pub(crate) half_across: &'a [f64],
    /// The gap between boxes that share a rank, and the keep-out gap around a box.
    pub(crate) spacing_cluster: f64,
}

/// The across variable of a box's top edge: the layered nodes come first, then two per box.
fn top_of(nodes: usize, box_index: usize) -> usize {
    nodes + 2 * box_index
}

/// The across variable of a box's bottom edge.
fn bottom_of(nodes: usize, box_index: usize) -> usize {
    nodes + 2 * box_index + 1
}

/// What each box rule reads: the input, the node count, and the boxes that contain each box.
struct Context<'a> {
    input: LevelBoxInput<'a>,
    nodes: usize,
    ancestors: Vec<BTreeSet<usize>>,
}

/// The across separations of every box, box by box: members, nesting, keep-out, then siblings.
pub(crate) fn box_separations(input: LevelBoxInput<'_>) -> Vec<Separation> {
    let plan = input.plan;
    let ancestors = (0..plan.boxes.len())
        .map(|b| ancestors_of(plan, b))
        .collect();
    let ctx = Context {
        nodes: input.ranks.len(),
        input,
        ancestors,
    };
    let mut out = Vec::new();
    for b in 0..plan.boxes.len() {
        out.extend(member_separations(&ctx, b));
        out.extend(nest_separations(&ctx, b));
        out.extend(keep_out_separations(&ctx, b));
        out.extend(sibling_separations(&ctx, b));
    }
    out
}

/// A box's top and bottom edges around its members, with the box's padding and label.
fn member_separations(ctx: &Context<'_>, b: usize) -> Vec<Separation> {
    let box_ = &ctx.input.plan.boxes[b];
    let mut out = Vec::with_capacity(2 * box_.members.len());
    for &m in &box_.members {
        let half = ctx.input.half_across[m];
        out.push(Separation {
            from: variable(top_of(ctx.nodes, b)),
            to: variable(m),
            gap: box_.padding + box_.label_height + half,
        });
        out.push(Separation {
            from: variable(m),
            to: variable(bottom_of(ctx.nodes, b)),
            gap: half + box_.padding,
        });
    }
    out
}

/// A nested box's edges sit inside its parent's: below the parent's top and label, above its bottom.
fn nest_separations(ctx: &Context<'_>, b: usize) -> Vec<Separation> {
    let plan = ctx.input.plan;
    let box_ = &plan.boxes[b];
    let Some(parent) = box_
        .parent
        .and_then(|cluster| plan.by_cluster.get(cluster).copied().flatten())
    else {
        return Vec::new();
    };
    let outer = &plan.boxes[parent];
    vec![
        Separation {
            from: variable(top_of(ctx.nodes, parent)),
            to: variable(top_of(ctx.nodes, b)),
            gap: outer.padding + outer.label_height,
        },
        Separation {
            from: variable(bottom_of(ctx.nodes, b)),
            to: variable(bottom_of(ctx.nodes, parent)),
            gap: outer.padding,
        },
    ]
}

/// A layered node of another rank that overlaps the box in-rank stays beyond the box's top when it is above, and beyond
/// its bottom when below. A member is never a keep-out.
fn keep_out_separations(ctx: &Context<'_>, b: usize) -> Vec<Separation> {
    let input = &ctx.input;
    let box_ = &input.plan.boxes[b];
    let mut is_member = vec![false; ctx.nodes];
    for &m in &box_.members {
        is_member[m] = true;
    }
    let left = input.in_rank[box_.left];
    let right = input.in_rank[box_.right];
    let mut out = Vec::new();
    for (w, &member) in is_member.iter().enumerate() {
        let lo = input.in_rank[w] - input.half_in[w];
        let hi = input.in_rank[w] + input.half_in[w];
        if member || lo >= right || hi <= left {
            continue;
        }
        let gap = input.half_across[w] + input.spacing_cluster;
        if input.ranks[w] < box_.top {
            out.push(Separation {
                from: variable(w),
                to: variable(top_of(ctx.nodes, b)),
                gap,
            });
        } else if input.ranks[w] > box_.bottom {
            out.push(Separation {
                from: variable(bottom_of(ctx.nodes, b)),
                to: variable(w),
                gap,
            });
        }
    }
    out
}

/// Two sibling boxes that share no rank and overlap in-rank: the one above keeps its bottom above the other's top. A
/// pair where one contains the other is left to the nesting.
fn sibling_separations(ctx: &Context<'_>, b: usize) -> Vec<Separation> {
    let input = &ctx.input;
    let box_ = &input.plan.boxes[b];
    let mut out = Vec::new();
    for a in 0..b {
        let other = &input.plan.boxes[a];
        let overlap_in = input.in_rank[other.left] < input.in_rank[box_.right]
            && input.in_rank[box_.left] < input.in_rank[other.right];
        if !overlap_in || ctx.ancestors[a].contains(&b) || ctx.ancestors[b].contains(&a) {
            continue;
        }
        if other.bottom < box_.top {
            out.push(sibling_pair(ctx, a, b));
        } else if box_.bottom < other.top {
            out.push(sibling_pair(ctx, b, a));
        }
    }
    out
}

/// The separation that keeps sibling box `upper` above sibling box `lower`, with the cluster spacing between.
fn sibling_pair(ctx: &Context<'_>, upper: usize, lower: usize) -> Separation {
    Separation {
        from: variable(bottom_of(ctx.nodes, upper)),
        to: variable(top_of(ctx.nodes, lower)),
        gap: ctx.input.spacing_cluster,
    }
}

/// The boxes that contain box `b`, found by walking up its parents. A cluster with no box ends the walk, as does a
/// box already found.
fn ancestors_of(plan: &BoxPlan, b: usize) -> BTreeSet<usize> {
    let mut found = BTreeSet::new();
    let mut parent = plan.boxes[b].parent;
    while let Some(cluster) = parent {
        let Some(p) = plan.by_cluster.get(cluster).copied().flatten() else {
            break;
        };
        if !found.insert(p) {
            break;
        }
        parent = plan.boxes[p].parent;
    }
    found
}
