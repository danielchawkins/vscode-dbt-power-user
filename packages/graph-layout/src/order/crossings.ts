import { ascending, sortedInInputOrder } from "../comparators.js";
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
  const sorted = sortedInInputOrder(links, [(l) => l[0], (l) => l[1]]);
  const lowers = [...new Set(sorted.map((link) => link[1]))].sort(ascending);
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

/**
 * One term of the crossings objective: the weighted crossings between one rank and the rank below it. Only
 * `totalCrossings` reads the terms. Its value is the reported `OrderResult.crossings` (through `found`), and the
 * restarts in `index.ts` choose among orders by it. Transpose and sifting choose their swaps by `groupCrossings` and
 * `pairCrossings`, and the barycentre sweeps read neither, so a term added here changes none of those swaps.
 * Attraction is not a crossing and must not enter this list, or it would enter `crossings`. Whether ordering reads
 * attraction at all is decision D-attr (ADR 0011, "Owner decisions"); if it does, it is a barycentre tie-break and a
 * pair-gain term, added beside these, not here.
 */
type CrossingTerm = { readonly kind: "crossings"; readonly rank: number };

/** The crossings terms: one per pair of adjacent ranks, from the top rank down. */
function crossingTerms(model: OrderModel): CrossingTerm[] {
  return Array.from(
    { length: Math.max(0, model.layers.length - 1) },
    (_, rank) => ({
      kind: "crossings" as const,
      rank,
    }),
  );
}

/** The value of one crossings term for `model`. */
function termValue(model: OrderModel, term: CrossingTerm): number {
  return rankCrossings(model, term.rank);
}

/** The weighted crossings of the whole drawing: the sum of the crossings terms over adjacent ranks, in rank order. */
export function totalCrossings(model: OrderModel): number {
  return crossingTerms(model).reduce(
    (total, term) => total + termValue(model, term),
    0,
  );
}

/**
 * The weighted crossings that the links of two nodes of one rank make when `left` sits to the left of `right`. Their
 * links at the rank above and at the rank below are both counted. Swapping two neighbours changes the total by the
 * difference of the two orders' pair counts, so the transpose and sifting searches read their gains from here.
 */
function pairCrossings(model: OrderModel, left: number, right: number): number {
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

/**
 * The weighted crossings that two units make when `left` sits left of `right`: the sum over their member pairs, since
 * every pair of segments is counted once whichever units they belong to.
 */
export function groupCrossings(
  model: OrderModel,
  left: readonly number[],
  right: readonly number[],
): number {
  let total = 0;
  for (const a of left) {
    for (const b of right) {
      total += pairCrossings(model, a, b);
    }
  }
  return total;
}
