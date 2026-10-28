import { crossingsAbove, touchesAbove } from "./channelCrossings.js";
import type { ChannelPiece, Hyperedge } from "./channelTypes.js";

/**
 * The preference graph: an edge from i to j where i should run above j. A pair with equal costs either way has no
 * preference. Cycles are broken where they occur: the node with fewest unmet predecessors goes next.
 */
export function preferences(
  pieces: readonly ChannelPiece[],
  tracked: readonly Hyperedge[],
  pairs: readonly [number, number][],
): number[][] {
  const succ: number[][] = tracked.map(() => []);
  for (const [i, j] of pairs) {
    const a = tracked[i];
    const b = tracked[j];
    if (!a || !b) {
      continue;
    }
    const ij = crossingsAbove(pieces, a, b) + touchesAbove(pieces, a, b);
    const ji = crossingsAbove(pieces, b, a) + touchesAbove(pieces, b, a);
    if (ij < ji) {
      succ[i]?.push(j);
    } else if (ji < ij) {
      succ[j]?.push(i);
    }
  }
  return succ;
}

/** Nodes in an order that respects every preference that is not part of a cycle; ties go to the lower index. */
function preferredOrder(succ: readonly (readonly number[])[]): number[] {
  const count = succ.length;
  const unmet = unmetCounts(succ);
  const queue = unmet.flatMap((u, i) => (u === 0 ? [i] : []));
  const done = Array.from({ length: count }, () => false);
  const order: number[] = [];
  for (let head = 0; order.length < count; head++) {
    if (head >= queue.length) {
      queue.push(fewestUnmet(unmet, done));
    }
    const v = queue[head] ?? -1;
    if (!done[v]) {
      done[v] = true;
      order.push(v);
      for (const j of succ[v] ?? []) {
        unmet[j] = (unmet[j] ?? 0) - 1;
        if (!done[j] && unmet[j] === 0) {
          queue.push(j);
        }
      }
    }
  }
  return order;
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

/** The undone node with fewest unmet predecessors, the lowest index on a tie: where a preference cycle is cut. */
function fewestUnmet(
  unmet: readonly number[],
  done: readonly boolean[],
): number {
  let best = -1;
  unmet.forEach((u, i) => {
    if (!done[i] && (best < 0 || u < (unmet[best] ?? 0))) {
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
  succ: readonly (readonly number[])[],
  edge: number,
): void {
  const preds: number[][] = tracked.map(() => []);
  succ.forEach((list, i) => {
    for (const j of list) {
      preds[j]?.push(i);
    }
  });
  const occupants: Hyperedge[][] = [];
  for (const v of preferredOrder(succ)) {
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
