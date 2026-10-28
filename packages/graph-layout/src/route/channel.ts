/**
 * Channel routing for the band between two adjacent ranks (or below the last rank, for flat edges). A piece is one
 * member edge's run through the band: it leaves its upper end, runs along a track and enters its lower end. Pieces
 * that share a point form one hyperedge, a star: all leave one upper point or all enter one lower point, and its members
 * share a track. A star that touches another hyperedge in the order chosen is split into single runs and placed again. Each
 * overlapping pair of hyperedges gets an above or below preference from the exact crossings each order would cost;
 * preference cycles are broken greedily; tracks are then assigned left edge first, below every overlapping hyperedge
 * preferred above it. A run that is alone in its hyperedge may then jog to a second track (`doglegs.ts`), where that lowers
 * its crossings plus touches.
 */

import {
  crossingsAbove,
  straightCrossings,
  touchesAbove,
} from "./channelCrossings.js";
import { hyperedgesOf, runsOf } from "./channelStars.js";
import { assignTracks, preferences } from "./channelTracks.js";
import type { ChannelPiece, Hyperedge, Jog } from "./channelTypes.js";
import { addDoglegs } from "./doglegs.js";

export interface ChannelOptions {
  /** Space between two tracks, and between two runs that share a track. */
  edge: number;
  /** Most overlapping pairs of hyperedges to examine. Past it the rest keep their left-edge tracks and `capped` is set. */
  budget: number;
  /** Most piece pairs the doglegs may test in the band; past it the runs keep their tracks. */
  doglegWork: number;
}

export interface ChannelRouting {
  /** Track of each piece, counted from the upper edge; -1 for a straight piece that needs none. */
  track: number[];
  /** The dogleg of each piece, if it has one: its second track and the in-rank coordinate of its jog. */
  jogs: (Jog | undefined)[];
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
  const { tracked, pairs, capped, examined } = placeSplittingTouches(
    pieces,
    all.filter((h) => h.hi > h.lo),
    options,
  );

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
  const solo = pieces.map(() => false);
  for (const h of [...straight, ...tracked]) {
    for (const m of h.members) {
      track[m] = h.track;
      solo[m] = h.members.length === 1;
    }
  }
  const trackCount = tracked.reduce(
    (most, h) => Math.max(most, h.track + 1),
    0,
  );
  const doglegs = addDoglegs({
    pieces,
    tracks: track,
    solo,
    trackCount,
    work: options.doglegWork,
  });
  return {
    track,
    jogs: doglegs.jogs,
    trackCount: doglegs.trackCount,
    crossings: crossings + doglegs.crossings,
    pairs: examined,
    capped,
  };
}

/** The tracked hyperedges in span order, their overlapping pairs, and whether the budget ran out. */
interface Placement {
  tracked: Hyperedge[];
  pairs: [number, number][];
  capped: boolean;
  /** Pairs examined over every placement round, which the budget bounds. */
  examined: number;
}

/** Orders the hyperedges by span, finds their overlapping pairs and assigns tracks. */
function place(
  pieces: readonly ChannelPiece[],
  hypers: readonly Hyperedge[],
  options: ChannelOptions,
): Placement {
  const tracked = hypers.toSorted((a, b) => a.lo - b.lo || a.hi - b.hi);
  const { pairs, capped } = overlappingPairs(tracked, options.budget);
  const prefs = preferences(pieces, tracked, pairs);
  assignTracks(tracked, prefs, options.edge);
  return { tracked, pairs, capped, examined: pairs.length };
}

/**
 * Places the hyperedges. Where a star touches another hyperedge in the order the placement chose, and the reverse
 * order would not, its runs are split into hyperedges of their own and the band is placed again, until no avoidable
 * touch is left or the budget is spent. Each round splits at least one star, so the loop ends. A touch that both
 * orders force remains.
 */
function placeSplittingTouches(
  pieces: readonly ChannelPiece[],
  hypers: readonly Hyperedge[],
  options: ChannelOptions,
): Placement {
  let current = hypers;
  let examined = 0;
  for (;;) {
    const placed = place(pieces, current, {
      ...options,
      budget: options.budget - examined,
    });
    examined += placed.examined;
    const touching = touchingStars(pieces, placed);
    if (touching.size === 0 || placed.capped) {
      return { ...placed, examined };
    }
    current = current.flatMap((h) =>
      touching.has(h) ? runsOf(pieces, h) : [h],
    );
  }
}

/** The stars that touch another hyperedge in the order the placement gives, where the reverse order would not. */
function touchingStars(
  pieces: readonly ChannelPiece[],
  placed: Placement,
): Set<Hyperedge> {
  const touching = new Set<Hyperedge>();
  for (const [i, j] of placed.pairs) {
    const a = placed.tracked[i];
    const b = placed.tracked[j];
    if (!a || !b) {
      continue;
    }
    const [upper, lower] = a.track < b.track ? [a, b] : [b, a];
    const here = touchesAbove(pieces, upper, lower);
    if (here > 0 && touchesAbove(pieces, lower, upper) < here) {
      for (const h of [upper, lower]) {
        if (h.members.length > 1) {
          touching.add(h);
        }
      }
    }
  }
  return touching;
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
