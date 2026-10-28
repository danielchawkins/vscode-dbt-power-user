import { legalSlots } from "./clusters.js";
import { groupCrossings } from "./crossings.js";
import { type OrderModel, setLayer, unitsOf } from "./model.js";

/** A gain smaller than this is rounding, not a change of crossings. */
const EPSILON = 1e-9;

/**
 * Sifting (Matuszewski, Schönfeld and Molitor, GD 1999): each unit of a rank in turn moves to the place in that rank
 * that gives the fewest crossings, the other units keeping their order. A unit is a node with its lateral port dummies,
 * so a block moves whole. A unit moves only for a strict gain, so the crossings never rise. Up to `rounds` passes over
 * the drawing run, stopping early when a pass moves nothing. Only the units whose block `movable` accepts move; the
 * others keep their places relative to one another.
 */
export function sift(
  model: OrderModel,
  rounds: number,
  movable: (node: number) => boolean = () => true,
): void {
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (let rank = 0; rank < model.layers.length; rank++) {
      moved = siftRank(model, rank, movable) || moved;
    }
    if (!moved) {
      return;
    }
  }
}

/**
 * Sifts one rank. A pair's cost depends only on the neighbouring ranks, not on where the pair sits in this rank, so
 * the pair costs are computed once and the rank is written back once at the end.
 */
function siftRank(
  model: OrderModel,
  rank: number,
  movable: (node: number) => boolean,
): boolean {
  const original = unitsOf(model.layers[rank]!, model.graph.block);
  const n = original.length;
  if (n < 2) {
    return false;
  }
  // cost[i][j] is the crossing count when original[i] sits left of original[j].
  const cost = original.map((a, i) =>
    original.map((b, j) => (i === j ? 0 : groupCrossings(model, a, b))),
  );
  let order = original.map((_, i) => i);
  const chains = original.map((unit) => model.graph.paths[unit[0]!]!);
  for (let v = 0; v < n; v++) {
    if (!movable(model.graph.block[original[v]![0]!]!)) {
      continue;
    }
    const others = order.filter((i) => i !== v);
    const costs = siftCosts(cost, v, others);
    const here = order.indexOf(v);
    const legal = legalSlots(
      chains[v]!,
      others.map((i) => chains[i]!),
      here,
    );
    let best = here;
    costs.forEach((c, k) => {
      if (legal[k] && c < costs[best]! - EPSILON) {
        best = k;
      }
    });
    if (best !== here) {
      others.splice(best, 0, v);
      order = others;
    }
  }
  const moved = order.some((i, k) => i !== k);
  if (moved) {
    setLayer(
      model,
      rank,
      order.flatMap((i) => original[i]!),
    );
  }
  return moved;
}

/**
 * The crossings of placing unit `v` in each slot of `others` (the other units, in order): slot k puts `v` after the
 * first k of them. Moving `v` past a unit swaps the two orders of that pair.
 */
function siftCosts(
  cost: readonly (readonly number[])[],
  v: number,
  others: readonly number[],
): number[] {
  let running = others.reduce((sum, u) => sum + cost[v]![u]!, 0);
  const costs = [running];
  for (const u of others) {
    running += cost[u]![v]! - cost[v]![u]!;
    costs.push(running);
  }
  return costs;
}
