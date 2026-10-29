import type { LayeredGraph } from "../layeredGraph.js";
import type { LayoutGraph, LayoutOptions, Spacing } from "../types.js";
import type { BoxPlan } from "./boxes.js";
import { rankCentres } from "./gaps.js";
import { levelsAcross } from "./levels.js";

/** Each rank's half-thickness across the drawing, and its centre, with `gaps[r]` between rank r and the next. */
export function acrossLayout({
  graph,
  layered,
  down,
  gaps,
}: {
  graph: LayoutGraph;
  layered: LayeredGraph;
  down: boolean;
  gaps: readonly number[];
}): { rankHalf: number[]; centres: number[]; half: number[] } {
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
  return { rankHalf, centres: rankCentres(rankHalf, gaps), half };
}

/** What the across axis is placed from. */
export interface AcrossInput {
  graph: LayoutGraph;
  options: LayoutOptions;
  layered: LayeredGraph;
  plan: BoxPlan;
  spacing: Pick<Spacing, "node" | "edge" | "cluster">;
  inRank: readonly number[];
  inRankHalf: readonly number[];
  half: readonly number[];
  centres: readonly number[];
  gaps: readonly number[];
  anchor: number | undefined;
}

/**
 * Each layered node's across position in the drawing's frame, the shift the rows took, and the boxes' top and bottom
 * edges when `ranks: "levels"` solves them (`undefined` for rows).
 */
export function acrossOf(input: AcrossInput): {
  across: number[];
  acrossShift: number;
  boxes: number[] | undefined;
} {
  const { layered, centres, anchor } = input;
  const acrossShift =
    anchor === undefined ? 0 : -centres[layered.nodes[anchor]!.rank]!;
  if (input.options.ranks !== "levels") {
    return {
      across: layered.nodes.map((node) => centres[node.rank]! + acrossShift),
      acrossShift,
      boxes: undefined,
    };
  }
  const levels = levelsAcross({
    graph: input.graph,
    options: input.options,
    layered,
    plan: input.plan,
    spacing: input.spacing,
    inRank: input.inRank,
    halfIn: input.inRankHalf,
    halfAcross: input.half,
    rankGap: input.gaps,
    anchor,
  });
  return { across: levels.across, acrossShift, boxes: levels.boxes };
}

/** The anchor's layered index, or `undefined` when no anchor is set or it is not in the layered graph. */
export function anchorIndex(
  nodes: readonly { id: string | undefined }[],
  anchor: string | undefined,
): number | undefined {
  if (anchor === undefined) {
    return undefined;
  }
  const index = nodes.findIndex((node) => node.id === anchor);
  return index < 0 ? undefined : index;
}
