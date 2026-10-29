import type { Separation } from "../constraints/types.js";
import type { LayeredGraph } from "../layeredGraph.js";
import type { Spacing } from "../types.js";
import type { BoxPlan } from "./boxes.js";

/** What the across separations of the cluster boxes are drawn from. */
export interface LevelBoxInput {
  layered: LayeredGraph;
  plan: BoxPlan;
  /** Every variable's in-rank position: the layered nodes, then each box's left and right edge. */
  inRank: readonly number[];
  /** Half the in-rank extent of each layered node. */
  halfIn: readonly number[];
  /** Half the across extent of each layered node. */
  halfAcross: readonly number[];
  spacing: Pick<Spacing, "cluster">;
}

/** The across variable of a box's top edge: the layered nodes come first, then two per box. */
function topOf(nodes: number, box: number): number {
  return nodes + 2 * box;
}

/** The across variable of a box's bottom edge. */
function bottomOf(nodes: number, box: number): number {
  return nodes + 2 * box + 1;
}

/** What each box rule reads: the input, the node count, and the boxes that contain each box. */
interface Context {
  input: LevelBoxInput;
  nodes: number;
  ancestors: readonly Set<number>[];
}

/**
 * The across separations of the cluster boxes, which mirror their in-rank ones: each box's top edge sits above its
 * members and its bottom edge below them, a nested box keeps its parent's padding, sibling boxes that share no rank
 * keep one order, and a node of another rank stays beyond the box on its side when the two overlap in-rank.
 */
export function boxSeparations(input: LevelBoxInput): Separation[] {
  const { plan, layered } = input;
  const ctx: Context = {
    input,
    nodes: layered.nodes.length,
    ancestors: plan.boxes.map((_, b) => ancestorsOf(plan, b)),
  };
  return plan.boxes.flatMap((_, b) => [
    ...memberSeparations(ctx, b),
    ...nestSeparations(ctx, b),
    ...keepOutSeparations(ctx, b),
    ...siblingSeparations(ctx, b),
  ]);
}

/** A box's top and bottom edges around its members, with the box's padding and label. */
function memberSeparations({ input, nodes }: Context, b: number): Separation[] {
  const { plan, halfAcross } = input;
  const box = plan.boxes[b]!;
  return box.members.flatMap((m) => [
    {
      from: topOf(nodes, b),
      to: m,
      gap: box.padding + box.labelHeight + halfAcross[m]!,
    },
    { from: m, to: bottomOf(nodes, b), gap: halfAcross[m]! + box.padding },
  ]);
}

/** A nested box's edges sit inside its parent's: below the parent's top and label, above its bottom. */
function nestSeparations({ input, nodes }: Context, b: number): Separation[] {
  const { plan } = input;
  const box = plan.boxes[b]!;
  const parent = plan.boxes.findIndex((p) => p.cluster === box.parent);
  if (box.parent === undefined || parent < 0) {
    return [];
  }
  const outer = plan.boxes[parent]!;
  return [
    {
      from: topOf(nodes, parent),
      to: topOf(nodes, b),
      gap: outer.padding + outer.labelHeight,
    },
    {
      from: bottomOf(nodes, b),
      to: bottomOf(nodes, parent),
      gap: outer.padding,
    },
  ];
}

/**
 * A layered node of another rank that overlaps the box in-rank stays beyond the box's top when it is above, and
 * beyond its bottom when below. A member is never a keep-out.
 */
function keepOutSeparations(
  { input, nodes }: Context,
  b: number,
): Separation[] {
  const { plan, layered, inRank, halfIn, halfAcross, spacing } = input;
  const box = plan.boxes[b]!;
  const members = new Set(box.members);
  const left = inRank[box.left]!;
  const right = inRank[box.right]!;
  const out: Separation[] = [];
  layered.nodes.forEach((node, w) => {
    const lo = inRank[w]! - halfIn[w]!;
    const hi = inRank[w]! + halfIn[w]!;
    if (members.has(w) || lo >= right || hi <= left) {
      return;
    }
    const gap = halfAcross[w]! + spacing.cluster;
    if (node.rank < box.top) {
      out.push({ from: w, to: topOf(nodes, b), gap });
    } else if (node.rank > box.bottom) {
      out.push({ from: bottomOf(nodes, b), to: w, gap });
    }
  });
  return out;
}

/**
 * Two sibling boxes that share no rank and overlap in-rank: the one above keeps its bottom above the other's top. A
 * pair where one contains the other is left to the nesting.
 */
function siblingSeparations(ctx: Context, b: number): Separation[] {
  const { plan, inRank } = ctx.input;
  const box = plan.boxes[b]!;
  const out: Separation[] = [];
  for (let a = 0; a < b; a++) {
    const other = plan.boxes[a]!;
    const overlapIn =
      inRank[other.left]! < inRank[box.right]! &&
      inRank[box.left]! < inRank[other.right]!;
    if (!overlapIn || ctx.ancestors[a]!.has(b) || ctx.ancestors[b]!.has(a)) {
      continue;
    }
    if (other.bottom < box.top) {
      out.push(siblingPair(ctx, a, b));
    } else if (box.bottom < other.top) {
      out.push(siblingPair(ctx, b, a));
    }
  }
  return out;
}

/** The separation that keeps sibling box `upper` above sibling box `lower`, with the cluster spacing between. */
function siblingPair(
  { input, nodes }: Context,
  upper: number,
  lower: number,
): Separation {
  return {
    from: bottomOf(nodes, upper),
    to: topOf(nodes, lower),
    gap: input.spacing.cluster,
  };
}

/** The boxes that contain box `b`, found by walking up its parents. */
function ancestorsOf(plan: BoxPlan, b: number): Set<number> {
  const found = new Set<number>();
  let parent = plan.boxes[b]!.parent;
  while (parent !== undefined) {
    const p = plan.boxes.findIndex((box) => box.cluster === parent);
    if (p < 0 || found.has(p)) {
      break;
    }
    found.add(p);
    parent = plan.boxes[p]!.parent;
  }
  return found;
}
