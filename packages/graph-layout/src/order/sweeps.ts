import { arrangeRank, arrangement } from "./clusters.js";
import { totalCrossings } from "./crossings.js";
import { type OrderModel, setLayer, slot } from "./model.js";
import { transpose } from "./transpose.js";

/** An order of the layered nodes with its weighted crossings. */
export interface Found {
  layers: number[][];
  crossings: number;
}

/**
 * Searches the order by alternating sweeps, each followed by transposition, and keeps the order with the fewest
 * crossings seen, the starting order included. Downward sweeps place each node by the weighted median of its upper
 * neighbours and upward sweeps by their weighted barycentre (Eades and Wormald, Algorithmica 11, 1994). The model is
 * left at the order it returns.
 */
export function search(model: OrderModel, count: number): Found {
  let best = found(model);
  for (let it = 0; it < count && best.crossings > 0; it++) {
    const downward = it % 2 === 0;
    sweep(model, downward, downward);
    transpose(model);
    const current = found(model);
    if (current.crossings < best.crossings) {
      best = current;
    }
  }
  best.layers.forEach((layer, rank) => setLayer(model, rank, [...layer]));
  return best;
}

/**
 * Reorders each rank in turn by the target of each node: a weighted median when `median` is set, otherwise a weighted
 * barycentre. A node with no neighbour in the rank the sweep came from keeps its place. The sweep runs downward from
 * the top rank, or upward from the bottom one.
 */
function sweep(model: OrderModel, downward: boolean, median: boolean): void {
  const ranks = model.layers.map((_, rank) => rank);
  const visit = downward ? ranks.slice(1) : ranks.slice(0, -1).reverse();
  const context = arrangement(model);
  for (const rank of ranks.filter((r) => !visit.includes(r))) {
    arrangeRank(model, rank, {
      context,
      keyOf: (unit) => model.index[unit[0]!]!,
    });
  }
  for (const rank of visit) {
    arrangeRank(model, rank, {
      context,
      keyOf: (unit) =>
        target(model, unit, { fromAbove: downward, median }) ??
        model.index[unit[0]!]!,
    });
  }
}

/** The order the model is in, copied, with its crossings. */
export function found(model: OrderModel): Found {
  return {
    layers: model.layers.map((layer) => [...layer]),
    crossings: totalCrossings(model),
  };
}

/**
 * The position a unit aims for: the weighted median or barycentre of the positions its members' neighbours in the
 * reference rank take, each read at its port's offset. Undefined when no member has a neighbour there.
 */
function target(
  model: OrderModel,
  members: readonly number[],
  { fromAbove, median }: { fromAbove: boolean; median: boolean },
): number | undefined {
  const { segments } = model.graph;
  const reads = members
    .flatMap((x) => (fromAbove ? model.up[x]! : model.down[x]!))
    .map((si) => {
      const s = segments[si]!;
      return fromAbove
        ? { at: slot(model, s.top, s.topOffset), weight: s.weight }
        : { at: slot(model, s.bottom, s.bottomOffset), weight: s.weight };
    });
  if (reads.length === 0) {
    return undefined;
  }
  return median ? weightedMedian(reads) : weightedMean(reads);
}

interface Read {
  at: number;
  weight: number;
}

function weightedMean(reads: readonly Read[]): number | undefined {
  const total = reads.reduce((sum, r) => sum + r.weight, 0);
  if (total <= 0) {
    return undefined;
  }
  return reads.reduce((sum, r) => sum + r.weight * r.at, 0) / total;
}

/** The weighted median; halfway between the two middle reads when the weight splits exactly in half. */
function weightedMedian(reads: readonly Read[]): number | undefined {
  const sorted = reads.toSorted((a, b) => a.at - b.at);
  const total = sorted.reduce((sum, r) => sum + r.weight, 0);
  if (total <= 0) {
    return undefined;
  }
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i]!.weight;
    if (2 * acc > total) {
      return sorted[i]!.at;
    }
    if (2 * acc === total) {
      return (sorted[i]!.at + (sorted[i + 1]?.at ?? sorted[i]!.at)) / 2;
    }
  }
  return undefined;
}
