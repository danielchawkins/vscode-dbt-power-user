import type { Problem } from "./problem.js";

/** Floor on a node's projection weight, so a block's weighted mean is always defined. */
const MIN_WEIGHT = 1e-12;

/** Adjacent nodes of one rank pooled into a block: their weighted mean of shifted coordinates, and their weight. */
interface Block {
  value: number;
  weight: number;
  size: number;
}

/**
 * Projects the coordinates of each rank onto its separation constraints, in the metric of `weight`: the nearest point,
 * by weighted squared distance, at which every node sits at least `gapLeft` beyond its left neighbour. Subtracting the
 * running sum of the gaps turns the constraints into a monotone fit, which weighted pool-adjacent-violators solves
 * exactly. `x` is changed in place. Only differences of gaps matter, so the gap of a rank's leftmost node is irrelevant.
 */
export function projectRanks(
  ranks: Pick<Problem, "layers" | "gapLeft">,
  x: number[],
  weight: ArrayLike<number>,
): void {
  for (const layer of ranks.layers) {
    const offsets: number[] = [];
    let total = 0;
    for (const v of layer) {
      total += ranks.gapLeft[v]!;
      offsets.push(total);
    }
    const blocks: Block[] = [];
    layer.forEach((v, k) => {
      let block: Block = {
        value: x[v]! - offsets[k]!,
        weight: Math.max(weight[v]!, MIN_WEIGHT),
        size: 1,
      };
      while (blocks.length > 0 && blocks.at(-1)!.value > block.value) {
        const prev = blocks.pop()!;
        const sum = prev.weight + block.weight;
        block = {
          value: (prev.value * prev.weight + block.value * block.weight) / sum,
          weight: sum,
          size: prev.size + block.size,
        };
      }
      blocks.push(block);
    });
    let k = 0;
    for (const block of blocks) {
      for (let j = 0; j < block.size; j++, k++) {
        x[layer[k]!] = block.value + offsets[k]!;
      }
    }
  }
}
