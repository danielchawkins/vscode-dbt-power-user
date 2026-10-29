import type { LayeredGraph } from "../layeredGraph.js";
import type { OrderResult } from "../order/index.js";
import type {
  LayoutGraph,
  LayoutOptions,
  Point,
  Rect,
  Spacing,
} from "../types.js";
import { acrossOf, acrossLayout, anchorIndex } from "./across.js";
import {
  type BoxPlan,
  initialEdges,
  planBoxes,
  tightenBoxes,
} from "./boxes.js";
import { type BoxFrame, boxRects } from "./boxRects.js";
import { brandesKoepf } from "./brandesKoepf.js";
import { hintShift } from "./hints.js";
import { problemOf } from "./links.js";
import type { Problem } from "./problem.js";
import { solveQuadratic } from "./quadratic.js";

type Effort = NonNullable<LayoutOptions["effort"]>;

/** Spacing used when `LayoutOptions.spacing` leaves a field out; the circuit preset's values. */
const DEFAULT_SPACING: Pick<Spacing, "node" | "rank" | "edge" | "cluster"> = {
  node: 12,
  rank: 28,
  edge: 4,
  cluster: 12,
};

/** Gradient-projection iterations by effort. At `fast` the Brandes and Köpf coordinates are the answer. */
const ITERATION_CAP: Record<Effort, number> = {
  fast: 0,
  balanced: 100,
  thorough: 500,
};

/** Where each node sits: real nodes by id, every layered node by index, and the work the solver did. */
export interface Placement {
  /** Centre of each real node, in the drawing's frame. */
  nodes: ReadonlyMap<string, Point>;
  /** Centre of every layered node, real nodes first then dummies, indexed as in the layered graph. */
  points: Point[];
  /** The rectangle of each cluster box, by cluster id. Empty when there are no clusters. */
  clusters: ReadonlyMap<string, Rect>;
  /** The boxes' edges in the drawing's frame: routing re-stacks the ranks and recomputes the boxes from these. */
  boxes: BoxFrame;
  /** Gradient-projection iterations taken: the work count. */
  work: number;
}

/**
 * Places every node of the ordering: along each rank, by minimising the weighted straightness of the segments under
 * the ordered separation constraints, from the Brandes and Köpf coordinates. Ranks sit at the cumulative thickness of
 * their nodes plus `spacing.rank`. An anchor lands exactly at the origin; without one, the drawing starts at the origin.
 * Hints are soft pulls towards their previous in-rank positions. Under `ranks: "levels"` the across positions come from
 * `levelsAcross` rather than from the rows.
 */
export function place(
  graph: LayoutGraph,
  options: LayoutOptions,
  ordering: OrderResult,
): Placement {
  const { layered, layers } = ordering;
  const spacing = { ...DEFAULT_SPACING, ...options.spacing };
  const effort: Effort = options.effort ?? "balanced";
  const down = options.direction === "down";
  const problem = problemOf(ordering, options, spacing);

  const inRankHalf = layered.nodes.map((node) => node.breadth / 2);
  const plan = planBoxes({
    layered,
    layers,
    clusters: graph.clusters ?? [],
    gapLeft: problem.gapLeft,
    half: inRankHalf,
    spacing: spacing.cluster,
  });
  // A rank gap is never below the spacing, and grows to hold the margins of the boxes it separates.
  const gaps = plan.rankGap.map((gap) => Math.max(spacing.rank, gap));
  const { rankHalf, centres, half } = acrossLayout({
    graph,
    layered,
    down,
    gaps,
  });
  const solved = solveInRank({ problem, plan, effort, inRankHalf });
  const x = tightenBoxes(plan, solved.x, inRankHalf);

  const anchor = anchorIndex(layered.nodes, options.anchor);
  const inShift = inRankShift({
    layered,
    x,
    inRankHalf,
    options,
  });
  const { across, acrossShift, boxes } = acrossOf({
    graph,
    options,
    layered,
    plan,
    spacing,
    inRank: x,
    inRankHalf,
    half,
    centres,
    gaps,
    anchor,
  });

  const { points, nodes } = positionsOf({
    layered,
    x,
    inShift,
    across,
    down,
  });
  const boxFrame: BoxFrame = {
    plan,
    down,
    edges: plan.boxes.flatMap((box) => [
      x[box.left]! + inShift,
      x[box.right]! + inShift,
    ]),
    ...(boxes === undefined ? {} : { across: boxes }),
  };
  const clusters = boxRects(
    boxFrame,
    centres.map((c) => c + acrossShift),
    rankHalf,
  );
  return { nodes, points, clusters, boxes: boxFrame, work: solved.iterations };
}

/**
 * The in-rank solution: the Brandes and Köpf start, improved by the quadratic solve over the boxes when there are any.
 * At `fast` without boxes the start is the answer.
 */
function solveInRank({
  problem,
  plan,
  effort,
  inRankHalf,
}: {
  problem: Problem;
  plan: BoxPlan;
  effort: Effort;
  inRankHalf: readonly number[];
}): { x: number[]; iterations: number } {
  const boxed: Problem =
    plan.count === 0
      ? problem
      : {
          ...problem,
          extra: { count: plan.count, separations: plan.separations },
        };
  const warm = brandesKoepf(problem);
  const cap = ITERATION_CAP[effort];
  const start =
    plan.count === 0
      ? warm
      : [...warm, ...initialEdges(plan, warm, inRankHalf)];
  return cap === 0 && plan.count === 0
    ? { x: warm, iterations: 0 }
    : solveQuadratic(boxed, start, cap);
}

/** Each layered node's point, from its in-rank position and its across position, and the real nodes by id. */
function positionsOf({
  layered,
  x,
  inShift,
  across,
  down,
}: {
  layered: LayeredGraph;
  x: readonly number[];
  inShift: number;
  across: readonly number[];
  down: boolean;
}): { points: Point[]; nodes: Map<string, Point> } {
  const points = layered.nodes.map((_, i) => {
    const inRank = x[i]! + inShift;
    return down ? { x: inRank, y: across[i]! } : { x: across[i]!, y: inRank };
  });
  const nodes = new Map<string, Point>();
  layered.nodes.forEach((node, i) => {
    if (node.id !== undefined) {
      nodes.set(node.id, points[i]!);
    }
  });
  return { points, nodes };
}

/** The translation along the ranks: the anchor at the origin, else the best fit to the hints, else the drawing's start. */
function inRankShift({
  layered,
  x,
  inRankHalf,
  options,
}: {
  layered: LayeredGraph;
  x: readonly number[];
  inRankHalf: readonly number[];
  options: LayoutOptions;
}): number {
  const anchor = anchorIndex(layered.nodes, options.anchor);
  if (anchor !== undefined) {
    return -x[anchor]!;
  }
  const hinted = hintShift(
    layered.nodes.map((node, i) => ({
      id: node.id,
      half: inRankHalf[i]!,
      x: x[i]!,
    })),
    options,
    true,
  );
  return (
    hinted ??
    -layered.nodes.reduce(
      (low, node, i) => Math.min(low, x[i]! - node.breadth / 2),
      Infinity,
    )
  );
}

/** The translation along the ranks: the anchor at the origin, else the best fit to the hints, else the drawing's start. */
