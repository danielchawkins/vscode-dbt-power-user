/**
 * Channel routing for the band between two adjacent ranks (or below the last rank, for flat edges). A piece is one
 * member edge's run through the band: it leaves its upper end, runs along a track and enters its lower end. Pieces
 * that share a point form one hyperedge, a star: all leave one upper point or all enter one lower point, and its members
 * share a track. A star that touches another hyperedge in the order chosen is split into single runs and placed again. Each
 * overlapping pair of hyperedges gets an above or below preference from the exact crossings each order would cost;
 * preference cycles are broken greedily; tracks are then assigned left edge first, below every overlapping hyperedge
 * preferred above it.
 */

import {
  crossingsAbove,
  straightCrossings,
  touchesAbove,
} from "./channelCrossings.js";
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
  const { tracked, pairs, capped } = placeSplittingTouches(
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

/** The tracked hyperedges in span order, their overlapping pairs, and whether the budget ran out. */
interface Placement {
  tracked: Hyperedge[];
  pairs: [number, number][];
  capped: boolean;
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
  return { tracked, pairs, capped };
}

/**
 * Places the hyperedges. Where a star touches another hyperedge in the order the placement chose, its runs are split
 * into hyperedges of their own and the band is placed again, until no star touches. Each round splits at least one
 * star, so the loop ends. A touch that both orders force, as for a swapped pair, remains.
 */
function placeSplittingTouches(
  pieces: readonly ChannelPiece[],
  hypers: readonly Hyperedge[],
  options: ChannelOptions,
): Placement {
  let current = hypers;
  for (;;) {
    const placed = place(pieces, current, options);
    const touching = touchingStars(pieces, placed);
    if (touching.size === 0) {
      return placed;
    }
    current = current.flatMap((h) =>
      touching.has(h) ? runsOf(pieces, h) : [h],
    );
  }
}

/** The hyperedges with more than one run that touch another hyperedge in the order the placement gives. */
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
    if (touchesAbove(pieces, upper, lower) > 0) {
      for (const h of [upper, lower]) {
        if (h.members.length > 1) {
          touching.add(h);
        }
      }
    }
  }
  return touching;
}

/** Each run of a hyperedge as a hyperedge of its own. */
function runsOf(pieces: readonly ChannelPiece[], h: Hyperedge): Hyperedge[] {
  return h.members.flatMap((m) => {
    const p = pieces[m];
    return p
      ? [
          {
            members: [m],
            lo: Math.min(p.from, p.to),
            hi: Math.max(p.from, p.to),
            track: -1,
          },
        ]
      : [];
  });
}

/** A hyperedge being grown: its members, its span, and the points every member shares. */
interface Star {
  members: number[];
  lo: number;
  hi: number;
  ups: number[];
  lows: number[];
}

/** The upper points a piece leaves from and the lower points it enters. */
function pointsOf(p: ChannelPiece): { ups: number[]; lows: number[] } {
  return p.flat
    ? { ups: [p.from, p.to], lows: [] }
    : { ups: [p.from], lows: [p.to] };
}

/**
 * Groups pieces into hyperedges that are stars: every member leaves one upper point, or every member enters one lower
 * point. A piece joins the first star that still shares a point with all its members; a piece that would make the star
 * share none starts one of its own. So no hyperedge chains an upper point to a lower point.
 */
function hyperedgesOf(pieces: readonly ChannelPiece[]): Hyperedge[] {
  const stars: Star[] = [];
  pieces.forEach((p, i) => {
    if (!stars.some((s) => admit(s, i, p))) {
      const { ups, lows } = pointsOf(p);
      stars.push({
        members: [i],
        lo: Math.min(p.from, p.to),
        hi: Math.max(p.from, p.to),
        ups,
        lows,
      });
    }
  });
  return stars.map(({ members, lo, hi }) => ({ members, lo, hi, track: -1 }));
}

/** Adds piece `i` to a star if they still share a point, keeping only the points they share; false if they share none. */
function admit(star: Star, i: number, p: ChannelPiece): boolean {
  const { ups, lows } = pointsOf(p);
  const sharedUps = star.ups.filter((u) => ups.includes(u));
  const sharedLows = star.lows.filter((l) => lows.includes(l));
  if (sharedUps.length === 0 && sharedLows.length === 0) {
    return false;
  }
  star.members.push(i);
  star.lo = Math.min(star.lo, p.from, p.to);
  star.hi = Math.max(star.hi, p.from, p.to);
  star.ups = sharedUps;
  star.lows = sharedLows;
  return true;
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
