import { sameChain } from "./clusters.js";
import { groupCrossings } from "./crossings.js";
import { type OrderModel, setLayer, unitsOf } from "./model.js";

/** Passes of transposition after a sweep. A pass that swaps nothing ends them earlier. */
const TRANSPOSE_PASSES = 4;

/**
 * Swaps neighbouring units in a rank while the swap lowers the crossings. A unit is a node with its lateral port
 * dummies, so it moves whole. Only units in the same innermost cluster swap, which keeps every cluster contiguous. Each
 * swap is an exact change of the total, so the crossings never rise. The model is left at the order it reaches.
 */
export function transpose(model: OrderModel): void {
  const { paths, block } = model.graph;
  for (
    let pass = 0, improved = true;
    improved && pass < TRANSPOSE_PASSES;
    pass++
  ) {
    improved = false;
    for (let rank = 0; rank < model.layers.length; rank++) {
      const units = unitsOf(model.layers[rank]!, block);
      for (let k = 0; k + 1 < units.length; k++) {
        const a = units[k]!;
        const b = units[k + 1]!;
        if (
          sameChain(paths[a[0]!]!, paths[b[0]!]!) &&
          groupCrossings(model, b, a) < groupCrossings(model, a, b)
        ) {
          units[k] = b;
          units[k + 1] = a;
          setLayer(model, rank, units.flat());
          improved = true;
        }
      }
    }
  }
}
