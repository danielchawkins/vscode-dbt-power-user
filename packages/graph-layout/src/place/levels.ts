import { projectAxis } from "../constraints/axis.js";
import type { AxisProblem } from "../constraints/types.js";
import type { LayeredGraph } from "../layeredGraph.js";
import type { LayoutGraph, LayoutOptions, Spacing } from "../types.js";
import type { BoxPlan } from "./boxes.js";
import { rankCentres } from "./gaps.js";
import { hintCorner, hintShift } from "./hints.js";
import { boxSeparations } from "./levelBoxes.js";
import { directedBundles, nodeSeparations } from "./levelNodes.js";

/** Weight of a box edge's desired position: small, so the boxes follow the nodes they hold, as the x solve does. */
const BOX_WEIGHT = 1e-3;

/** What the across axis is solved from: the in-rank solution, the extents, the rank gaps and the boxes' plan. */
export interface LevelsInput {
  graph: LayoutGraph;
  options: LayoutOptions;
  layered: LayeredGraph;
  plan: BoxPlan;
  spacing: Pick<Spacing, "node" | "edge" | "cluster">;
  /** Every variable's in-rank position: the layered nodes, then each box's left and right edge. */
  inRank: readonly number[];
  /** Half the in-rank extent, and half the across extent, of each layered node. */
  halfIn: readonly number[];
  halfAcross: readonly number[];
  /** The gap between each rank and the next, as the rows use it. */
  rankGap: readonly number[];
  /** The anchor's layered index, if the anchor is in the layered graph. */
  anchor: number | undefined;
}

/** The across positions: each layered node, and each box's top and bottom edge as `[top, bottom]` pairs. */
export interface LevelsResult {
  across: number[];
  boxes: number[];
}

/**
 * Places the layered nodes across the ranks under `ranks: "levels"`. Each node is drawn to its rank's row, or to its
 * hint when it has one; every directed segment and every overlapping pair of nodes of different ranks keeps its
 * order; each box's edges hold its members and the nodes beside it. The result is one axis problem, solved exactly.
 * An anchor lands at the origin across the ranks; without one the layout starts at the origin.
 */
export function levelsAcross(input: LevelsInput): LevelsResult {
  const { graph, options, layered, plan, spacing } = input;
  const n = layered.nodes.length;
  const nodes = nodeTargets(
    input,
    levelRows(layered, input.halfAcross, input.rankGap),
  );
  const problem: AxisProblem = {
    desired: [...nodes.desired, ...boxTargets(input, nodes.desired)],
    weight: [
      ...nodes.weight,
      ...plan.boxes.flatMap(() => [BOX_WEIGHT, BOX_WEIGHT]),
    ],
    separations: [
      ...nodeSeparations({
        layered,
        directed: directedBundles(graph, layered, options),
        inRank: input.inRank,
        halfIn: input.halfIn,
        halfAcross: input.halfAcross,
        rankGap: input.rankGap,
        spacing,
      }),
      ...boxSeparations({
        layered,
        plan,
        inRank: input.inRank,
        halfIn: input.halfIn,
        halfAcross: input.halfAcross,
        spacing,
      }),
    ],
  };
  const solved = projectAxis(problem);
  const shift = acrossShift(input, solved.slice(0, n), solved.slice(n));
  return {
    across: solved.slice(0, n).map((v) => v + shift),
    boxes: solved.slice(n).map((v) => v + shift),
  };
}

/**
 * The level of each rank: the centres of the ranks stacked from the origin at the half-extent of their shortest real
 * node, so a taller node of the rank sits below its level and pushes the nodes below it down.
 */
function levelRows(
  layered: LayeredGraph,
  halfAcross: readonly number[],
  rankGap: readonly number[],
): number[] {
  const shortest = Array.from({ length: layered.ranks }, () => Infinity);
  layered.nodes.forEach((node, i) => {
    if (node.id !== undefined) {
      shortest[node.rank] = Math.min(shortest[node.rank]!, halfAcross[i]!);
    }
  });
  return rankCentres(
    shortest.map((h) => (Number.isFinite(h) ? h : 0)),
    rankGap,
  );
}

/**
 * The desired across centre of each node, and its weight. A hinted node is drawn to its hint, weighted by stability;
 * any other node to the level of its rank, with weight one.
 */
function nodeTargets(
  { options, layered, halfAcross }: LevelsInput,
  rows: readonly number[],
): { desired: number[]; weight: number[] } {
  const stability = options.stability ?? 1;
  const hintOf = (id: string | undefined) =>
    id === undefined || stability <= 0
      ? undefined
      : options.hints?.nodes.get(id);
  const hints = layered.nodes.map((node) => hintOf(node.id));
  return {
    desired: layered.nodes.map((node, i) => {
      const hint = hints[i];
      return hint === undefined
        ? rows[node.rank]!
        : hintCorner(hint, options, false) + halfAcross[i]!;
    }),
    weight: hints.map((hint) => (hint === undefined ? 1 : stability)),
  };
}

/**
 * The desired top and bottom of each box: around its members' desired centres, with the box's padding, and its label
 * above the top.
 */
function boxTargets(
  { plan, halfAcross }: LevelsInput,
  desired: readonly number[],
): number[] {
  return plan.boxes.flatMap((box) => {
    const tops = box.members.map((m) => desired[m]! - halfAcross[m]!);
    const bottoms = box.members.map((m) => desired[m]! + halfAcross[m]!);
    return [
      tops.reduce((low, t) => Math.min(low, t), Infinity) -
        box.padding -
        box.labelHeight,
      bottoms.reduce((high, b) => Math.max(high, b), -Infinity) + box.padding,
    ];
  });
}

/**
 * The translation that places the drawing: the anchor at the origin when there is one, else the best fit to the hints,
 * else the lowest edge of the nodes and boxes at the origin.
 */
function acrossShift(
  { layered, options, halfAcross, anchor }: LevelsInput,
  across: readonly number[],
  boxEdges: readonly number[],
): number {
  if (anchor !== undefined) {
    return -across[anchor]!;
  }
  const hinted = hintShift(
    layered.nodes.map((node, i) => ({
      id: node.id,
      half: halfAcross[i]!,
      x: across[i]!,
    })),
    options,
    false,
  );
  if (hinted !== undefined) {
    return hinted;
  }
  const edges = [
    ...across.map((v, i) => v - halfAcross[i]!),
    ...boxEdges.filter((_, i) => i % 2 === 0),
  ];
  return -edges.reduce((low, e) => Math.min(low, e), Infinity);
}
