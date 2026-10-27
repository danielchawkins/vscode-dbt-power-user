import { pairCrossings } from "./crossings.js";
import { type OrderModel, setLayer } from "./model.js";

/** Passes of transposition after a sweep. A pass that swaps nothing ends them earlier. */
const TRANSPOSE_PASSES = 4;

/**
 * Swaps neighbours in a rank while the swap lowers the crossings. Each swap is an exact change of the total, so the
 * crossings never rise. The model is left at the order it reaches.
 */
export function transpose(model: OrderModel): void {
  for (
    let pass = 0, improved = true;
    improved && pass < TRANSPOSE_PASSES;
    pass++
  ) {
    improved = false;
    for (let rank = 0; rank < model.layers.length; rank++) {
      for (let k = 0; k + 1 < model.layers[rank]!.length; k++) {
        const layer = model.layers[rank]!;
        const a = layer[k]!;
        const b = layer[k + 1]!;
        if (pairCrossings(model, b, a) < pairCrossings(model, a, b)) {
          const swapped = [...layer];
          swapped[k] = b;
          swapped[k + 1] = a;
          setLayer(model, rank, swapped);
          improved = true;
        }
      }
    }
  }
}
