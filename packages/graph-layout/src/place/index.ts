import type { OrderResult } from "../order/index.js";
import type { LayoutGraph, LayoutOptions, Point, Spacing } from "../types.js";
import { brandesKoepf } from "./brandesKoepf.js";
import type { Link, Problem, Pull } from "./problem.js";
import { solveQuadratic } from "./quadratic.js";

type Effort = NonNullable<LayoutOptions["effort"]>;

/** Spacing used when `LayoutOptions.spacing` leaves a field out; the circuit preset's values. */
const DEFAULT_SPACING: Pick<Spacing, "node" | "rank" | "edge"> = {
  node: 12,
  rank: 28,
  edge: 4,
};

/** Gradient-projection iterations by effort. At `fast` the Brandes and Köpf coordinates are the answer. */
const ITERATION_CAP: Record<Effort, number> = {
  fast: 0,
  balanced: 100,
  thorough: 500,
};

/** Link weight factor by the number of dummy ends: real-real, real-dummy and dummy-dummy. */
const DUMMY_FACTOR = [1, 2, 8];

/** Pull weight that holds the anchor at the origin before the translation that makes it exact. */
const ANCHOR_WEIGHT = 100;

/** Where each node sits: real nodes by id, every layered node by index, and the work the solver did. */
export interface Placement {
  /** Centre of each real node, in the drawing's frame. */
  nodes: ReadonlyMap<string, Point>;
  /** Centre of every layered node, real nodes first then dummies, indexed as in the layered graph. */
  points: Point[];
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
  const centres = rankCentres(rankHalf, spacing.rank);

  const dummy = layered.nodes.map((node) => node.id === undefined);
  const problem: Problem = {
    layers,
    gapLeft: gapsLeft(layers, layered.nodes, spacing),
    dummy,
    links: layered.segments.map((segment) => {
      const ends = [segment.top, segment.bottom].filter((i) => dummy[i]).length;
      return {
        top: segment.top,
        bottom: segment.bottom,
        weight: segment.weight * DUMMY_FACTOR[ends]!,
        topOffset: segment.topOffset,
        bottomOffset: segment.bottomOffset,
      } satisfies Link;
    }),
    pulls: pullsOf(layered.nodes, options),
  };

  const warm = brandesKoepf(problem);
  const cap = ITERATION_CAP[effort];
  const solved =
    cap === 0 ? { x: warm, iterations: 0 } : solveQuadratic(problem, warm, cap);

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
  return { nodes, points, work: solved.iterations };
}

/** Each rank's centre across the drawing: ranks are stacked from the origin, with `gap` between their extents. */
function rankCentres(half: readonly number[], gap: number): number[] {
  const centres: number[] = [];
  let edge = 0;
  for (const h of half) {
    centres.push(edge + h);
    edge += 2 * h + gap;
  }
  return centres;
}

/**
 * The least gap between each node and its left neighbour in its rank: half of each breadth plus the node spacing
 * between two real nodes, or the edge spacing when a dummy is one of them. The leftmost node of a rank has no gap.
 */
function gapsLeft(
  layers: readonly (readonly number[])[],
  nodes: readonly { id: string | undefined; breadth: number }[],
  spacing: Pick<Spacing, "node" | "edge">,
): number[] {
  const gaps = nodes.map(() => 0);
  for (const layer of layers) {
    layer.slice(1).forEach((v, k) => {
      const left = nodes[layer[k]!]!;
      const right = nodes[v]!;
      const real = left.id !== undefined && right.id !== undefined;
      const gap = real ? spacing.node : spacing.edge;
      gaps[v] = (left.breadth + right.breadth) / 2 + gap;
    });
  }
  return gaps;
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

/**
 * The pulls: the anchor is held at zero; each hinted real node is drawn to its previous in-rank centre, weighted by
 * `stability`. A hint gives the top-left corner, so the centre adds half the node's breadth.
 */
function pullsOf(
  nodes: readonly {
    id: string | undefined;
    breadth: number;
  }[],
  options: LayoutOptions,
): Pull[] {
  const stability = options.stability ?? 1;
  const pulls: Pull[] = [];
  nodes.forEach((node, i) => {
    if (node.id === undefined) {
      return;
    }
    if (node.id === options.anchor) {
      pulls.push({ node: i, weight: ANCHOR_WEIGHT, target: 0 });
      return;
    }
    const hint = options.hints?.nodes.get(node.id);
    if (hint !== undefined && stability > 0) {
      const corner = options.direction === "down" ? hint.x : hint.y;
      pulls.push({
        node: i,
        weight: stability,
        target: corner + node.breadth / 2,
      });
    }
  });
  return pulls;
}
