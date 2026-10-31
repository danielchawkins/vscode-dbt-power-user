//! Coordinates from the order and the separation solver: the in-rank placement of each rank, a port of
//! `packages/graph-layout/src/place/` (ADR 0011, module table). `place` imports only `solve`, `across`, `order` and
//! `index` (rule `rust-core-layer-imports-place`), so its input is the plain `Problem` of `problem`, which the caller
//! states from the layered graph.
//!
//! `place` is the orchestrator of the rows path (`ranks: "rows"`): the Brandes and Köpf start, the box plan and its
//! tightening, the quadratic solve over the boxes, the hint shift, the across axis of the rows, and the box rectangles.
//! `boxes` is the entry route reads (the restacking frame and the rectangles). The levels path (`levelsAcross`) is not
//! ported yet.

#[cfg(test)]
mod alignment;
#[cfg(test)]
mod box_gaps;
#[cfg(test)]
mod box_order;
#[cfg(test)]
mod box_rects;
#[cfg(test)]
mod boxes;
#[cfg(test)]
mod brandes_koepf;
#[cfg(test)]
mod compaction;
#[cfg(test)]
mod gaps;
#[cfg(test)]
mod hints;
#[cfg(test)]
mod offsets;
#[cfg(test)]
mod problem;
#[cfg(test)]
mod projection;
#[cfg(test)]
mod quadratic;
#[cfg(test)]
mod terms;

#[cfg(test)]
use crate::across::{across_layout, across_of_rows, anchor_index};
#[cfg(test)]
use crate::solve::SolveError;
#[cfg(test)]
use box_rects::{BoxFrame, BoxRect, box_rects};
#[cfg(test)]
use boxes::{BoxInput, ClusterSpec, initial_edges, plan_boxes, tighten_boxes};
#[cfg(test)]
use brandes_koepf::brandes_koepf;
#[cfg(test)]
use hints::{Hint, HintedNode, hint_shift};
#[cfg(test)]
use problem::{Extension, Problem};
#[cfg(test)]
use quadratic::solve_quadratic;

/// A node's position in the drawing's frame.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Point {
    pub(crate) x: f64,
    pub(crate) y: f64,
}

/// Spacing the placement reads: the node gap and edge gap in `problem`, the rank gap between ranks, and the cluster gap
/// between boxes. Each is a minimum, as in `Spacing`.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Spacing {
    pub(crate) rank: f64,
    pub(crate) cluster: f64,
}

/// What the rows placement is built from. The caller states the layered graph in plain data: the in-rank problem, each
/// node's rank, its half-extents, its clusters and the ids that anchor and hint it.
#[cfg(test)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct PlaceInput<'a> {
    /// The in-rank problem of the ordering: layers, gaps, links and pulls. Its extension is not set; `place` adds the
    /// box edges.
    pub(crate) problem: &'a Problem,
    /// The number of ranks.
    pub(crate) ranks: usize,
    /// The rank of each layered node.
    pub(crate) node_ranks: &'a [usize],
    /// The clusters that contain each layered node, outermost first.
    pub(crate) paths: &'a [Vec<usize>],
    /// Every cluster, by index.
    pub(crate) clusters: &'a [ClusterSpec],
    /// Half the in-rank breadth of each layered node.
    pub(crate) in_rank_half: &'a [f64],
    /// The full extent of each layered node across the ranks; 0 for a dummy.
    pub(crate) across_extent: &'a [f64],
    /// The id of each layered node; `None` for a dummy.
    pub(crate) ids: &'a [Option<&'a str>],
    /// The previous top-left corner of each hinted node, by layered index; `None` for an unhinted node or a dummy.
    pub(crate) hints: &'a [Option<Hint>],
    /// The anchor's id: held at the origin, when it is in the layered graph.
    pub(crate) anchor: Option<&'a str>,
    /// Whether the ranks run down the drawing.
    pub(crate) down: bool,
    /// Spacing used by the box plan and the rank gaps.
    pub(crate) spacing: Spacing,
    /// Gradient-projection iterations of the in-rank solve (`Budget::place_iterations`). Zero keeps the start.
    pub(crate) iterations: usize,
}

/// Where each layered node sits, the box frame that routing restacks from, and the work the solver did.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Placement {
    /// Centre of every layered node, indexed as in the layered graph.
    pub(crate) points: Vec<Point>,
    /// The boxes' edges along the ranks, in the drawing's frame.
    pub(crate) boxes: BoxFrame,
    /// Centre of each rank across the drawing, already shifted by the anchor.
    pub(crate) centres: Vec<f64>,
    /// Half-thickness of each rank across the drawing.
    pub(crate) rank_half: Vec<f64>,
    /// Gradient-projection iterations taken: the work count.
    pub(crate) work: usize,
}

/// Places every node of the rows: along each rank, by minimising the weighted straightness of the segments under the
/// ordered separation constraints, from the Brandes and Köpf coordinates. Ranks sit at the cumulative thickness of their
/// nodes plus the rank gap. An anchor lands exactly at the origin; without one, the drawing starts at the origin.
#[cfg(test)]
pub(crate) fn place(input: &PlaceInput<'_>) -> Result<Placement, SolveError> {
    let problem = input.problem;
    let spacing = input.spacing;
    let plan = plan_boxes(&BoxInput {
        ranks: input.ranks,
        node_ranks: input.node_ranks,
        paths: input.paths,
        layers: &problem.layers,
        clusters: input.clusters,
        gap_left: &problem.gap_left,
        half: input.in_rank_half,
        spacing: spacing.cluster,
    });
    // A rank gap is never below the spacing, and grows to hold the margins of the boxes it separates.
    let gaps: Vec<f64> = plan
        .rank_gap
        .iter()
        .map(|&gap| gap.max(spacing.rank))
        .collect();
    let layout = across_layout(input.node_ranks, input.ranks, input.across_extent, &gaps);

    let solved = solve_in_rank(problem, &plan, input.in_rank_half, input.iterations)?;
    let x = tighten_boxes(&plan, &solved.0, input.in_rank_half);

    let anchor = anchor_index(input.ids, input.anchor);
    let in_shift = in_rank_shift(input, &x, anchor);
    let rows = across_of_rows(input.node_ranks, &layout.centres, anchor);
    let centres: Vec<f64> = layout.centres.iter().map(|c| c + rows.shift).collect();

    let frame = BoxFrame {
        edges: plan
            .boxes
            .iter()
            .flat_map(|b| [x[b.left] + in_shift, x[b.right] + in_shift])
            .collect(),
        plan,
        down: input.down,
        across: None,
    };
    let points = x
        .iter()
        .zip(&rows.across)
        .map(|(&along, &across)| {
            let along = along + in_shift;
            if input.down {
                Point {
                    x: along,
                    y: across,
                }
            } else {
                Point {
                    x: across,
                    y: along,
                }
            }
        })
        .collect();
    Ok(Placement {
        points,
        boxes: frame,
        centres,
        rank_half: layout.rank_half,
        work: solved.1,
    })
}

/// The rectangles of the cluster boxes of a placement, in box order. This is the entry route reads with
/// `Placement::boxes`: it re-stacks the ranks by recomputing each box's extent across them from the frame.
#[cfg(test)]
pub(crate) fn boxes(placement: &Placement) -> Vec<BoxRect> {
    box_rects(&placement.boxes, &placement.centres, &placement.rank_half)
}

/// The in-rank solution and the iterations taken. The Brandes and Köpf start is improved by the quadratic solve over the
/// boxes when there are any; with no iterations and no boxes the start is the answer.
#[cfg(test)]
fn solve_in_rank(
    problem: &Problem,
    plan: &boxes::BoxPlan,
    in_rank_half: &[f64],
    cap: usize,
) -> Result<(Vec<f64>, usize), SolveError> {
    let warm = brandes_koepf(problem);
    if plan.count == 0 && cap == 0 {
        return Ok((warm, 0));
    }
    let boxed = Problem {
        extra: (plan.count != 0).then(|| Extension {
            count: plan.count,
            separations: plan.separations.clone(),
        }),
        ..problem.clone()
    };
    let start = if plan.count == 0 {
        warm
    } else {
        let mut start = warm.clone();
        start.extend(initial_edges(plan, &warm, in_rank_half));
        start
    };
    let solution = solve_quadratic(&boxed, &start, cap)?;
    Ok((solution.x, solution.iterations))
}

/// The translation along the ranks: the anchor at the origin, else the best fit to the hints, else the drawing's start.
#[cfg(test)]
fn in_rank_shift(input: &PlaceInput<'_>, x: &[f64], anchor: Option<usize>) -> f64 {
    if let Some(a) = anchor {
        return -x[a];
    }
    let nodes: Vec<HintedNode> = x
        .iter()
        .enumerate()
        .map(|(i, &along)| HintedNode {
            hint: input.hints[i],
            half: input.in_rank_half[i],
            x: along,
        })
        .collect();
    hint_shift(&nodes, input.down, true).unwrap_or_else(|| {
        -x.iter()
            .zip(input.in_rank_half)
            .map(|(&along, &half)| along - half)
            .fold(f64::INFINITY, f64::min)
    })
}

#[cfg(test)]
mod tests {
    use super::{PlaceInput, Point, Spacing, boxes, place};
    use crate::place::problem::{Link, Problem};

    /// Two ranks of one node each, joined by one link; the anchor is the upper node, so it lands at the origin and the
    /// lower rank sits one rank gap below its half-thickness (28 + 5 + 5 = 38 from the anchor's rank centre).
    #[test]
    fn a_two_rank_chain_places_its_anchor_at_the_origin_and_stacks_the_rows() {
        let problem = Problem {
            layers: vec![vec![0], vec![1]],
            gap_left: vec![0.0, 0.0],
            dummy: vec![false, false],
            links: vec![Link::new(0, 1)],
            pulls: vec![],
            extra: None,
        };
        let input = PlaceInput {
            problem: &problem,
            ranks: 2,
            node_ranks: &[0, 1],
            paths: &[vec![], vec![]],
            clusters: &[],
            in_rank_half: &[5.0, 5.0],
            across_extent: &[10.0, 10.0],
            ids: &[Some("a"), Some("b")],
            hints: &[None, None],
            anchor: Some("a"),
            down: true,
            spacing: Spacing {
                rank: 28.0,
                cluster: 12.0,
            },
            iterations: 0,
        };
        let placement = place(&input).expect("the chain places");
        assert_eq!(placement.points[0], Point { x: 0.0, y: 0.0 });
        assert_eq!(placement.points[1].y, 38.0);
        assert_eq!(placement.work, 0);
        assert_eq!(boxes(&placement).len(), 0);
    }
}
