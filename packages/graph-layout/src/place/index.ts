import type { LayeredGraph } from "../layeredGraph.js";
import type { OrderResult } from "../order/index.js";
import type {
  LayoutGraph,
  LayoutOptions,
  Point,
  Rect,
  Spacing,
} from "../types.js";
import { initialEdges, planBoxes } from "./boxes.js";
import { type BoxFrame, boxRects } from "./boxRects.js";
import { brandesKoepf } from "./brandesKoepf.js";
import { rankCentres } from "./gaps.js";
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

/** Each rank's half-thickness across the drawing, and its centre, with `gaps[r]` between rank r and the next. */
function acrossLayout({
  graph,
  layered,
  down,
  gaps,
}: {
  graph: LayoutGraph;
  layered: LayeredGraph;
  down: boolean;
  gaps: readonly number[];
}): { rankHalf: number[]; centres: number[] } {
  const sizes = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const acrossOf = (id: string | undefined): number => {
    if (id === undefined) {
      return 0;
    }
    const node = sizes.get(id);
    return node === undefined ? 0 : down ? node.height : node.width;
  };
  const half = layered.nodes.map((node) => acrossOf(node.id) / 2);
  const rankHalf = Array.from({ length: layered.ranks }, (_, r) =>
    Math.max(
      0,
      ...layered.nodes.flatMap((node, i) =>
        node.rank === r ? [half[i]!] : [],
      ),
    ),
  );
  return { rankHalf, centres: rankCentres(rankHalf, gaps) };
}

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
 * Hints are soft pulls towards their previous in-rank positions.
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
  const { rankHalf, centres } = acrossLayout({
    graph,
    layered,
    down,
    gaps: plan.rankGap.map((gap) => Math.max(spacing.rank, gap)),
  });
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
  const solved =
    cap === 0 && plan.count === 0
      ? { x: warm, iterations: 0 }
      : solveQuadratic(boxed, start, cap);

  const anchor = anchorIndex(layered.nodes, options.anchor);
  const inShift =
    anchor !== undefined
      ? -solved.x[anchor]!
      : (hintShift(layered.nodes, solved.x, options) ??
        -layered.nodes.reduce(
          (low, node, i) => Math.min(low, solved.x[i]! - node.breadth / 2),
          Infinity,
        ));
  const acrossShift =
    anchor === undefined ? 0 : -centres[layered.nodes[anchor]!.rank]!;

  const points = layered.nodes.map((node, i) => {
    const inRank = solved.x[i]! + inShift;
    const across = centres[node.rank]! + acrossShift;
    return down ? { x: inRank, y: across } : { x: across, y: inRank };
  });
  const nodes = new Map<string, Point>();
  layered.nodes.forEach((node, i) => {
    if (node.id !== undefined) {
      nodes.set(node.id, points[i]!);
    }
  });
  const boxFrame: BoxFrame = {
    plan,
    down,
    edges: plan.boxes.flatMap((box) => [
      solved.x[box.left]! + inShift,
      solved.x[box.right]! + inShift,
    ]),
  };
  const clusters = boxRects(
    boxFrame,
    centres.map((c) => c + acrossShift),
    rankHalf,
  );
  return { nodes, points, clusters, boxes: boxFrame, work: solved.iterations };
}

/**
 * The translation that best fits the hinted nodes to their previous centres: the mean of (hint - x). Translation is
 * free, so it applies whatever the effort or stability. `undefined` when no real node is hinted.
 */
function hintShift(
  nodes: readonly { id: string | undefined; breadth: number }[],
  x: readonly number[],
  options: LayoutOptions,
): number | undefined {
  let sum = 0;
  let count = 0;
  nodes.forEach((node, i) => {
    const hint =
      node.id === undefined ? undefined : options.hints?.nodes.get(node.id);
    if (hint !== undefined) {
      const corner = options.direction === "down" ? hint.x : hint.y;
      sum += corner + node.breadth / 2 - x[i]!;
      count += 1;
    }
  });
  return count === 0 ? undefined : sum / count;
}

/** The anchor's layered index, or `undefined` when no anchor is set or it is not in the layered graph. */
function anchorIndex(
  nodes: readonly { id: string | undefined }[],
  anchor: string | undefined,
): number | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  const index = nodes.findIndex((node) => node.id === anchor);
  return index < 0 ? undefined : index;
}
