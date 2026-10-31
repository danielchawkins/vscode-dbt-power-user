//! The across axis of `ranks: "levels"`, a port of `packages/graph-layout/src/place/levels.ts`. Each node is drawn to its
//! rank's level, or to its hint when it has one; every directed segment and every overlapping pair keeps its order; each
//! box's edges hold its members and the nodes beside it. The result is one axis problem, solved by the separation
//! solver: the problem has no equalities, so the TypeScript reduction is the identity and is not repeated here.

use super::boxes::BoxPlan;
use super::hints::{Hint, HintedNode, hint_corner, hint_shift};
use super::level_boxes::{LevelBoxInput, box_separations};
use super::level_nodes::{LevelNodeInput, node_separations};
use super::links::Segment;
use crate::across::rank_centres;
use crate::solve::{Problem, SolveError, solve};

/// Weight of a box edge's desired position: small, so the boxes follow the nodes they hold, as the x solve does.
const BOX_WEIGHT: f64 = 1e-3;

/// What the across axis is solved from: the box plan, the layered graph, the in-rank solution and the extents.
#[derive(Debug, Clone, Copy)]
pub(crate) struct LevelsInput<'a> {
    /// The box plan, whose boxes and in-rank edge variables the across boxes mirror.
    pub(crate) plan: &'a BoxPlan,
    /// The layered segments, with each one's direction.
    pub(crate) segments: &'a [Segment],
    /// Each layered node's rank, and the number of ranks.
    pub(crate) ranks: &'a [usize],
    pub(crate) rank_count: usize,
    /// Whether each layered node is real (it has an id), and its hint, which is `None` for a dummy.
    pub(crate) real: &'a [bool],
    pub(crate) hints: &'a [Option<Hint>],
    /// The pull of a hint, and whether the ranks run down the drawing.
    pub(crate) stability: f64,
    pub(crate) down: bool,
    /// Every variable's in-rank position: the layered nodes, then each box's left and right edge.
    pub(crate) in_rank: &'a [f64],
    /// Half the in-rank extent, and half the across extent, of each layered node.
    pub(crate) half_in: &'a [f64],
    pub(crate) half_across: &'a [f64],
    /// The gap between each rank and the next, as the rows use it.
    pub(crate) rank_gap: &'a [f64],
    /// The node, edge and cluster spacing.
    pub(crate) spacing_node: f64,
    pub(crate) spacing_edge: f64,
    pub(crate) spacing_cluster: f64,
    /// The anchor's layered index, if the anchor is in the layered graph.
    pub(crate) anchor: Option<usize>,
}

/// The across positions: each layered node, and each box's top and bottom edge as `[top, bottom]` pairs.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LevelsResult {
    pub(crate) across: Vec<f64>,
    pub(crate) boxes: Vec<f64>,
}

/// Places the layered nodes across the ranks under `ranks: "levels"`. An anchor lands at the origin across the ranks;
/// without one the layout starts at the origin.
///
/// # Errors
///
/// Returns [`SolveError`] when the separation solver rejects the axis problem.
pub(crate) fn levels_across(input: &LevelsInput<'_>) -> Result<LevelsResult, SolveError> {
    let n = input.ranks.len();
    let (mut desired, mut weight) = node_targets(input, &level_rows(input));
    let box_desired = box_targets(input, &desired);
    desired.extend(box_desired);
    weight.extend(
        input
            .plan
            .boxes
            .iter()
            .flat_map(|_| [BOX_WEIGHT, BOX_WEIGHT]),
    );

    let mut separations = node_separations(&LevelNodeInput {
        ranks: input.ranks,
        real: input.real,
        segments: input.segments,
        in_rank: input.in_rank,
        half_in: input.half_in,
        half_across: input.half_across,
        rank_gap: input.rank_gap,
        spacing_node: input.spacing_node,
        spacing_edge: input.spacing_edge,
    });
    separations.extend(box_separations(LevelBoxInput {
        plan: input.plan,
        ranks: input.ranks,
        in_rank: input.in_rank,
        half_in: input.half_in,
        half_across: input.half_across,
        spacing_cluster: input.spacing_cluster,
    }));

    let solved = solve(&Problem {
        x0: &desired,
        weight: &weight,
        separations: &separations,
    })?;
    let shift = across_shift(input, &solved[..n], &solved[n..]);
    Ok(LevelsResult {
        across: solved[..n].iter().map(|v| v + shift).collect(),
        boxes: solved[n..].iter().map(|v| v + shift).collect(),
    })
}

/// The level of each rank: the centres of the ranks stacked from the origin at the half-extent of their shortest real
/// node, so a taller node of the rank sits below its level and pushes the nodes below it down.
fn level_rows(input: &LevelsInput<'_>) -> Vec<f64> {
    let mut shortest = vec![f64::INFINITY; input.rank_count];
    for (i, &rank) in input.ranks.iter().enumerate() {
        if input.real[i] {
            shortest[rank] = shortest[rank].min(input.half_across[i]);
        }
    }
    let half: Vec<f64> = shortest
        .into_iter()
        .map(|h| if h.is_finite() { h } else { 0.0 })
        .collect();
    rank_centres(&half, input.rank_gap)
}

/// The desired across centre of each node, and its weight. A hinted node is drawn to its hint, weighted by stability;
/// any other node to the level of its rank, with weight one. A hint has no pull when stability is not positive.
fn node_targets(input: &LevelsInput<'_>, rows: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let mut desired = Vec::with_capacity(input.ranks.len());
    let mut weight = Vec::with_capacity(input.ranks.len());
    for (i, &rank) in input.ranks.iter().enumerate() {
        let hint = input.hints[i].filter(|_| input.stability > 0.0);
        match hint {
            None => {
                desired.push(rows[rank]);
                weight.push(1.0);
            }
            Some(hint) => {
                desired.push(hint_corner(hint, input.down, false) + input.half_across[i]);
                weight.push(input.stability);
            }
        }
    }
    (desired, weight)
}

/// The desired top and bottom of each box: around its members' desired centres, with the box's padding, and its label
/// above the top.
fn box_targets(input: &LevelsInput<'_>, desired: &[f64]) -> Vec<f64> {
    let mut out = Vec::with_capacity(2 * input.plan.boxes.len());
    for box_ in &input.plan.boxes {
        let top = box_.members.iter().fold(f64::INFINITY, |low, &m| {
            low.min(desired[m] - input.half_across[m])
        });
        let bottom = box_.members.iter().fold(f64::NEG_INFINITY, |high, &m| {
            high.max(desired[m] + input.half_across[m])
        });
        out.push(top - box_.padding - box_.label_height);
        out.push(bottom + box_.padding);
    }
    out
}

/// The translation that places the drawing: the anchor at the origin when there is one, else the best fit to the hints,
/// else the lowest edge of the nodes and boxes at the origin. The hint fit reads every hint, as the rows' fit does.
fn across_shift(input: &LevelsInput<'_>, across: &[f64], box_edges: &[f64]) -> f64 {
    if let Some(anchor) = input.anchor {
        return -across[anchor];
    }
    let nodes: Vec<HintedNode> = input
        .hints
        .iter()
        .zip(input.half_across)
        .zip(across)
        .map(|((&hint, &half), &x)| HintedNode { hint, half, x })
        .collect();
    if let Some(shift) = hint_shift(&nodes, input.down, false) {
        return shift;
    }
    let low = across
        .iter()
        .zip(input.half_across)
        .map(|(&v, &half)| v - half)
        .chain(box_edges.iter().step_by(2).copied())
        .fold(f64::INFINITY, f64::min);
    -low
}
