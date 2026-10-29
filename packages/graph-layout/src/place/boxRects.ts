import type { Rect } from "../types.js";
import { acrossExtents, type BoxPlan } from "./boxes.js";

/** The cluster boxes of a placement: their plan, and each box's edge along the ranks in the drawing's frame. */
export interface BoxFrame {
  plan: BoxPlan;
  /** Left and right edge of each box, as `[left, right]` pairs flattened in box order, in the drawing's frame. */
  edges: number[];
  /**
   * Top and bottom edge of each box across the ranks, as `[top, bottom]` pairs, when the across axis is solved per
   * node (`ranks: "levels"`). Absent when the boxes take their extent from the rows.
   */
  across?: number[];
  down: boolean;
}

/**
 * The rectangle of each cluster box, by cluster id. Its edges along the ranks come from the frame; its extent across
 * the ranks comes from the frame's solved edges when it has them, and otherwise from the ranks' centres and
 * half-heights, so that a re-stacked drawing gets its boxes recomputed.
 */
export function boxRects(
  frame: BoxFrame,
  centres: readonly number[],
  rankHalf: readonly number[],
): Map<string, Rect> {
  const { plan, edges, down, across: solvedAcross } = frame;
  const extents = acrossExtents(plan, centres, rankHalf);
  return new Map(
    plan.boxes.map((box, b) => {
      const along: [number, number] = [edges[2 * b]!, edges[2 * b + 1]!];
      const across: [number, number] =
        solvedAcross === undefined
          ? [extents[b]!.top, extents[b]!.bottom]
          : [solvedAcross[2 * b]!, solvedAcross[2 * b + 1]!];
      return [box.id, rectOf(down, along, across)] as const;
    }),
  );
}

/** A rectangle from its extents along the rank direction and across it; `down` ranks run top to bottom. */
function rectOf(
  down: boolean,
  [a0, a1]: readonly number[],
  [c0, c1]: readonly number[],
): Rect {
  return down
    ? { x: a0!, y: c0!, width: a1! - a0!, height: c1! - c0! }
    : { x: c0!, y: a0!, width: c1! - c0!, height: a1! - a0! };
}
