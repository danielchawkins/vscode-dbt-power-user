/**
 * Hyperedges of one band: stars of pieces that leave one upper point or enter one lower point, and the single runs a
 * star is split into when it touches another in the order placement chose.
 */

import type { ChannelPiece, Hyperedge } from "./channelTypes.js";

/** Each run of a hyperedge as a hyperedge of its own. */
export function runsOf(
  pieces: readonly ChannelPiece[],
  h: Hyperedge,
): Hyperedge[] {
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
export function hyperedgesOf(pieces: readonly ChannelPiece[]): Hyperedge[] {
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
