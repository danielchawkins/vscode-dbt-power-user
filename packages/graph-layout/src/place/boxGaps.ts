/** The parts of a cluster box that its margins read. A box of `boxes.ts` has them, so the two modules need not import each other. */
export interface MarginBox {
  cluster: number;
  parent: number | undefined;
  top: number;
  bottom: number;
  padding: number;
  labelHeight: number;
}

/** How far a box is drawn above its first rank and below its last, beyond the rank itself. */
interface Margins {
  above: number;
  below: number;
}

/**
 * How far the boxes are drawn beyond each rank: `below[r]` past rank `r`'s bottom by the boxes ending there, and
 * `above[r]` before its top by the boxes starting there. A box is drawn past its first rank by its padding and label,
 * and past its last rank by its padding.
 */
export function rankMargins(
  boxes: readonly MarginBox[],
  ranks: number,
): { below: number[]; above: number[] } {
  const below = Array.from({ length: ranks }, () => 0);
  const above = Array.from({ length: ranks }, () => 0);
  boxes.forEach((box, i) => {
    const margins = marginsOf(boxes, i);
    below[box.bottom] = Math.max(below[box.bottom]!, margins.below);
    above[box.top] = Math.max(above[box.top]!, margins.above);
  });
  return { below, above };
}

/**
 * The least gap between each pair of adjacent ranks that keeps the drawn boxes apart: the bottom margins of the boxes
 * ending at rank `r` and the top margins of those starting at `r + 1`. Gap `r` lies between ranks `r` and `r + 1`.
 */
export function rankGaps(boxes: readonly MarginBox[], ranks: number): number[] {
  const { below, above } = rankMargins(boxes, ranks);
  return Array.from(
    { length: Math.max(0, ranks - 1) },
    (_, r) => below[r]! + above[r + 1]!,
  );
}

/**
 * A box's margins with those of its nested boxes: a parent holds each child with the parent's padding. A child spans
 * ranks inside its parent's, so this bounds how far any child is drawn.
 */
function marginsOf(boxes: readonly MarginBox[], i: number): Margins {
  const box = boxes[i]!;
  let above = box.padding + box.labelHeight;
  let below = box.padding;
  for (const child of boxes) {
    if (child.parent === box.cluster) {
      const inner = marginsOf(boxes, boxes.indexOf(child));
      above = Math.max(above, inner.above + box.padding);
      below = Math.max(below, inner.below + box.padding);
    }
  }
  return { above, below };
}
