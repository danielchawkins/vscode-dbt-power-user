import { Fenwick } from "../fenwick.js";
import { type OrderModel, slot } from "./model.js";

/** A link between two adjacent ranks: its position at the upper rank, at the lower rank, and its weight. */
type Link = readonly [upper: number, lower: number, weight: number];

/**
 * The weighted number of crossings among links between two adjacent ranks, by Barth, Jünger and Mutzel's accumulator
 * tree (JGAA 8(2), 2004). Two links cross when their order at the upper rank and at the lower rank differ strictly;
 * a crossing counts the product of the two weights. Links that share a position at either rank do not cross.
 */
function countCrossings(links: readonly Link[]): number {
  const sorted = links.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lowers = [...new Set(sorted.map((link) => link[1]))].sort(
    (a, b) => a - b,
  );
  const column = new Map(lowers.map((value, k) => [value, k] as const));
  const tree = new Fenwick(lowers.length);
  let seen = 0;
  let total = 0;
  for (const [, lower, weight] of sorted) {
    const k = column.get(lower)!;
    total += weight * (seen - tree.prefix(k + 1));
    tree.add(k, weight);
    seen += weight;
  }
  return total;
}

/** The weighted crossings between the links of `rank` and the rank below it. */
function rankCrossings(model: OrderModel, rank: number): number {
  const { segments } = model.graph;
  const links: Link[] = [];
  for (const x of model.layers[rank] ?? []) {
    for (const si of model.down[x]!) {
      const s = segments[si]!;
      links.push([
        slot(model, x, s.topOffset),
        slot(model, s.bottom, s.bottomOffset),
        s.weight,
      ]);
    }
  }
  return countCrossings(links);
}

/** The weighted crossings of the whole drawing, summed over every pair of adjacent ranks. */
export function totalCrossings(model: OrderModel): number {
  let total = 0;
  for (let rank = 0; rank + 1 < model.layers.length; rank++) {
    total += rankCrossings(model, rank);
  }
  return total;
}

/**
 * The weighted crossings that the links of two nodes of one rank make when `left` sits to the left of `right`. Their
 * links at the rank above and at the rank below are both counted. Swapping two neighbours changes the total by the
 * difference of the two orders' pair counts, so the transpose and sifting searches read their gains from here.
 */
export function pairCrossings(
  model: OrderModel,
  left: number,
  right: number,
): number {
  const { segments } = model.graph;
  let total = 0;
  for (const si of model.down[left]!) {
    for (const sj of model.down[right]!) {
      const a = segments[si]!;
      const b = segments[sj]!;
      if (
        slot(model, a.bottom, a.bottomOffset) >
        slot(model, b.bottom, b.bottomOffset)
      ) {
        total += a.weight * b.weight;
      }
    }
  }
  for (const si of model.up[left]!) {
    for (const sj of model.up[right]!) {
      const a = segments[si]!;
      const b = segments[sj]!;
      if (slot(model, a.top, a.topOffset) > slot(model, b.top, b.topOffset)) {
        total += a.weight * b.weight;
      }
    }
  }
  return total;
}
