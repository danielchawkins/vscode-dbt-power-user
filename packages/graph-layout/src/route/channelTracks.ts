import { crossingsAbove, touchesAbove } from "./channelCrossings.js";
import type { ChannelPiece, Hyperedge } from "./channelTypes.js";

/** What one order of a pair costs: the touches it makes, and the crossings it makes. */
interface OrderCost {
  touches: number;
  crossings: number;
}

/**
 * The preference graph. `succ[i]` lists the hyperedges that should run below i; `touchSucc[i]` is the part of that list
 * where the preference is to avoid a touch, which cycle breaking must keep whenever it can.
 */
export interface Preferences {
  succ: number[][];
  touchSucc: number[][];
}

function orderCost(
  pieces: readonly ChannelPiece[],
  upper: Hyperedge,
  lower: Hyperedge,
): OrderCost {
  return {
    touches: touchesAbove(pieces, upper, lower),
    crossings: crossingsAbove(pieces, upper, lower),
  };
}

/**
 * Whether the order `x` is preferred to `y`. A touch costs more than any number of crossings: two verticals lying on one
 * line are worse than two runs crossing, so the order with fewer touches wins, and crossings only break a tie.
 */
function cheaper(x: OrderCost, y: OrderCost): boolean {
  return (
    x.touches < y.touches ||
    (x.touches === y.touches && x.crossings < y.crossings)
  );
}

/**
 * The preference graph over the pairs. A pair that costs the same either way has no preference. Cycles are broken
 * where they occur: see `preferredOrder`.
 */
export function preferences(
  pieces: readonly ChannelPiece[],
  tracked: readonly Hyperedge[],
  pairs: readonly [number, number][],
): Preferences {
  const succ: number[][] = tracked.map(() => []);
  const touchSucc: number[][] = tracked.map(() => []);
  for (const [i, j] of pairs) {
    const a = tracked[i];
    const b = tracked[j];
    if (!a || !b) {
      continue;
    }
    const ij = orderCost(pieces, a, b);
    const ji = orderCost(pieces, b, a);
    const [upper, lower] = cheaper(ij, ji)
      ? [i, j]
      : cheaper(ji, ij)
        ? [j, i]
        : [-1, -1];
    if (upper < 0) {
      continue;
    }
    succ[upper]?.push(lower);
    if (ij.touches !== ji.touches) {
      touchSucc[upper]?.push(lower);
    }
  }
  return { succ, touchSucc };
}

/**
 * Nodes in an order that respects every preference that is not part of a cycle; ties go to the lower index. Where a
 * cycle is cut, the node with fewest unmet touch preferences goes next, so a touch is given up only when every
 * remaining choice gives one up too.
 */
function preferredOrder(prefs: Preferences): number[] {
  const count = prefs.succ.length;
  const state: OrderState = {
    unmet: unmetCounts(prefs.succ),
    touchUnmet: unmetCounts(prefs.touchSucc),
    done: Array.from({ length: count }, () => false),
    queue: [],
  };
  state.queue = state.unmet.flatMap((u, i) => (u === 0 ? [i] : []));
  const order: number[] = [];
  for (let head = 0; order.length < count; head++) {
    if (head >= state.queue.length) {
      state.queue.push(fewestUnmet(state.touchUnmet, state.unmet, state.done));
    }
    const v = state.queue[head] ?? -1;
    if (!state.done[v]) {
      order.push(v);
      release(prefs, state, v);
    }
  }
  return order;
}

/** The state of `preferredOrder` while it runs. */
interface OrderState {
  unmet: number[];
  touchUnmet: number[];
  done: boolean[];
  queue: number[];
}

/** Marks `v` done and lowers the unmet counts of the hyperedges it precedes; those that reach none join the queue. */
function release(prefs: Preferences, state: OrderState, v: number): void {
  state.done[v] = true;
  for (const j of prefs.touchSucc[v] ?? []) {
    state.touchUnmet[j] = (state.touchUnmet[j] ?? 0) - 1;
  }
  for (const j of prefs.succ[v] ?? []) {
    state.unmet[j] = (state.unmet[j] ?? 0) - 1;
    if (!state.done[j] && state.unmet[j] === 0) {
      state.queue.push(j);
    }
  }
}

/** For each node, the number of preferences that name it as the one to run below. */
function unmetCounts(succ: readonly (readonly number[])[]): number[] {
  const unmet = Array.from({ length: succ.length }, () => 0);
  for (const list of succ) {
    for (const j of list) {
      unmet[j] = (unmet[j] ?? 0) + 1;
    }
  }
  return unmet;
}

/**
 * The undone node with fewest unmet touch preferences, then fewest unmet preferences, the lowest index on a tie: where
 * a preference cycle is cut.
 */
function fewestUnmet(
  touchUnmet: readonly number[],
  unmet: readonly number[],
  done: readonly boolean[],
): number {
  const weight = unmet.length + 1;
  const score = (i: number): number =>
    (touchUnmet[i] ?? 0) * weight + (unmet[i] ?? 0);
  let best = -1;
  unmet.forEach((_, i) => {
    if (!done[i] && (best < 0 || score(i) < score(best))) {
      best = i;
    }
  });
  return best;
}

/**
 * Left-edge assignment in preference order: each hyperedge takes the lowest track that is below every overlapping
 * hyperedge preferred above it and clears every hyperedge already on that track by `edge`.
 */
export function assignTracks(
  tracked: Hyperedge[],
  prefs: Preferences,
  edge: number,
): void {
  const preds: number[][] = tracked.map(() => []);
  prefs.succ.forEach((list, i) => {
    for (const j of list) {
      preds[j]?.push(i);
    }
  });
  const occupants: Hyperedge[][] = [];
  for (const v of preferredOrder(prefs)) {
    const h = tracked[v];
    if (!h) {
      continue;
    }
    let t = trackBelow(preds[v] ?? [], tracked);
    while (occupants[t]?.some((o) => tooClose(o, h, edge))) {
      t++;
    }
    (occupants[t] ??= []).push(h);
    h.track = t;
  }
}

/** The lowest track below every hyperedge in `above` that has a track. */
function trackBelow(
  above: readonly number[],
  tracked: readonly Hyperedge[],
): number {
  let t = 0;
  for (const p of above) {
    const track = tracked[p]?.track ?? -1;
    if (track >= 0) {
      t = Math.max(t, track + 1);
    }
  }
  return t;
}

/** Whether two hyperedges on one track come closer than `edge`, end to end. */
function tooClose(a: Hyperedge, b: Hyperedge, edge: number): boolean {
  return a.lo < b.hi + edge && b.lo < a.hi + edge;
}
