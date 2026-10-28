/**
 * Channel routing for the band between two adjacent ranks (or below the last rank, for flat edges). A piece is one
 * member edge's run through the band: it leaves its upper end, runs along a track and enters its lower end. Pieces
 * that leave or enter the same point form one hyperedge and share a track. Each overlapping pair of hyperedges gets an
 * above or below preference from the exact crossings each order would cost; preference cycles are broken greedily;
 * tracks are then assigned left edge first, below every overlapping hyperedge preferred above it.
 */

import { crossingsAbove, straightCrossings } from "./channelCrossings.js";
import { assignTracks, preferences } from "./channelTracks.js";
import type { ChannelPiece, Hyperedge } from "./channelTypes.js";

export interface ChannelOptions {
  /** Space between two tracks, and between two runs that share a track. */
  edge: number;
  /** Most overlapping pairs of hyperedges to examine. Past it the rest keep their left-edge tracks and `capped` is set. */
  budget: number;
}

export interface ChannelRouting {
  /** Track of each piece, counted from the upper edge; -1 for a straight piece that needs none. */
  track: number[];
  /** Tracks used, so the band needs `(trackCount + 1) * edge` of width. */
  trackCount: number;
  /** Proper crossings between runs of different trunks, as `measureDrawing` counts them within the band. */
  crossings: number;
  /** Overlapping pairs of hyperedges examined: the work count. */
  pairs: number;
  /** Set when `budget` ran out, so `crossings` misses the pairs that were not examined. */
  capped: boolean;
}

/** Routes the pieces of one band onto tracks, minimising the crossings the preferences can see. */
export function routeChannel(
  pieces: readonly ChannelPiece[],
  options: ChannelOptions,
): ChannelRouting {
  const all = hyperedgesOf(pieces);
  const straight = all.filter((h) => h.hi === h.lo);
  const tracked = all
    .filter((h) => h.hi > h.lo)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const { pairs, capped } = overlappingPairs(tracked, options.budget);
  const succ = preferences(pieces, tracked, pairs);
  assignTracks(tracked, succ, options.edge);

  let crossings = 0;
  for (const [i, j] of pairs) {
    const a = tracked[i];
    const b = tracked[j];
    if (a && b) {
      crossings +=
        a.track < b.track
          ? crossingsAbove(pieces, a, b)
          : crossingsAbove(pieces, b, a);
    }
  }
  for (const s of straight) {
    crossings += straightCrossings(pieces, s.members, tracked);
  }
  for (const h of tracked) {
    crossings += straightCrossings(pieces, h.members, [h]);
  }

  const track = pieces.map(() => -1);
  for (const h of [...straight, ...tracked]) {
    for (const m of h.members) {
      track[m] = h.track;
    }
  }
  return {
    track,
    trackCount: tracked.reduce((most, h) => Math.max(most, h.track + 1), 0),
    crossings,
    pairs: pairs.length,
    capped,
  };
}

/** Groups pieces that share an upper or a lower point, transitively, into hyperedges. */
function hyperedgesOf(pieces: readonly ChannelPiece[]): Hyperedge[] {
  const parent = pieces.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r] ?? r;
    }
    return r;
  };
  const join = (seen: Map<number, number>, x: number, i: number) => {
    const j = seen.get(x);
    if (j === undefined) {
      seen.set(x, i);
    } else {
      parent[root(i)] = root(j);
    }
  };
  const upper = new Map<number, number>();
  const lower = new Map<number, number>();
  pieces.forEach((p, i) => {
    join(upper, p.from, i);
    if (p.flat) {
      join(upper, p.to, i);
    } else {
      join(lower, p.to, i);
    }
  });
  const byRoot = new Map<number, Hyperedge>();
  pieces.forEach((p, i) => {
    const r = root(i);
    const h = byRoot.get(r) ?? {
      members: [],
      lo: Number.POSITIVE_INFINITY,
      hi: Number.NEGATIVE_INFINITY,
      track: -1,
    };
    h.members.push(i);
    h.lo = Math.min(h.lo, p.from, p.to);
    h.hi = Math.max(h.hi, p.from, p.to);
    byRoot.set(r, h);
  });
  return [...byRoot.values()];
}

/**
 * Every pair of tracked hyperedges whose spans overlap, found by a sweep over their starts. Stops at the budget.
 * `hypers` is sorted by start, so each hyperedge is compared only with those that start before it ends.
 */
function overlappingPairs(
  hypers: readonly Hyperedge[],
  budget: number,
): { pairs: [number, number][]; capped: boolean } {
  const pairs: [number, number][] = [];
  let capped = false;
  for (let i = 0; i < hypers.length && !capped; i++) {
    const a = hypers[i];
    for (let j = i + 1; a && j < hypers.length && !capped; j++) {
      const b = hypers[j];
      if (!b || b.lo > a.hi) {
        break;
      }
      if (pairs.length >= budget) {
        capped = true;
      } else {
        pairs.push([i, j]);
      }
    }
  }
  return { pairs, capped };
}
