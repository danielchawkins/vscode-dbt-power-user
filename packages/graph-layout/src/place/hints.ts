import type { LayoutOptions } from "../types.js";

/**
 * The top-left corner a hint gives a node, along one axis: `inRank` selects the axis the ranks run along. A hint gives
 * the corner, so a centre adds half the node's extent along that axis.
 */
export function hintCorner(
  hint: { x: number; y: number },
  options: LayoutOptions,
  inRank: boolean,
): number {
  return (options.direction === "down") === inRank ? hint.x : hint.y;
}

/**
 * The translation that best fits the hinted nodes to their previous centres along one axis: the mean of
 * (hint - x). Translation is free, so it applies whatever the effort or stability. `undefined` when no real node is
 * hinted. Each node gives its id (absent for a dummy), its half-extent and its position along the axis.
 */
export function hintShift(
  nodes: readonly { id: string | undefined; half: number; x: number }[],
  options: LayoutOptions,
  inRank: boolean,
): number | undefined {
  let sum = 0;
  let count = 0;
  for (const { id, half, x } of nodes) {
    const hint = id === undefined ? undefined : options.hints?.nodes.get(id);
    if (hint !== undefined) {
      sum += hintCorner(hint, options, inRank) + half - x;
      count += 1;
    }
  }
  return count === 0 ? undefined : sum / count;
}
