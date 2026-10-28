import type { ChannelPiece, Hyperedge } from "./channelTypes.js";

/**
 * Crossings within one band, counted as `measureDrawing` counts them: runs with one trunk never cross each other, and
 * a run with no trunk shares none. Each count probes with one run, the vertical that may cross the others' tracks.
 */

/** Whether a run may cross another: they must not leave from one source port. */
function crossable(a: ChannelPiece, b: ChannelPiece): boolean {
  return a.trunk === undefined || a.trunk !== b.trunk;
}

/** A vertical probing a hyperedge: its x, and the run it belongs to. */
interface Probe {
  x: number;
  probe: ChannelPiece;
}

/** The number of member runs of a hyperedge that pass strictly through `at.x` and may cross `at.probe`. */
function insideCount(
  pieces: readonly ChannelPiece[],
  h: Hyperedge,
  at: Probe,
): number {
  let count = 0;
  for (const m of h.members) {
    const p = pieces[m];
    if (
      p &&
      Math.min(p.from, p.to) < at.x &&
      at.x < Math.max(p.from, p.to) &&
      crossable(p, at.probe)
    ) {
      count++;
    }
  }
  return count;
}

/**
 * Crossings of straight runs (from equal to to) with the tracked hyperedges: each such run is a vertical through the
 * whole band, so it cuts every run of those tracks that passes its x.
 */
export function straightCrossings(
  pieces: readonly ChannelPiece[],
  members: readonly number[],
  tracked: readonly Hyperedge[],
): number {
  let count = 0;
  for (const m of members) {
    const p = pieces[m];
    if (p && p.from === p.to) {
      for (const h of tracked) {
        count += insideCount(pieces, h, { x: p.from, probe: p });
      }
    }
  }
  return count;
}

/**
 * Shared points when `upper` runs above `lower`: an upper's lower end at the same x as a lower's upper end, where the
 * two verticals would lie one on the other. Not a crossing, so `measureDrawing` does not count it, but it is charged
 * in the preference so that the order without the overlap wins.
 */
export function touchesAbove(
  pieces: readonly ChannelPiece[],
  upper: Hyperedge,
  lower: Hyperedge,
): number {
  let count = 0;
  for (const m of upper.members) {
    const p = pieces[m];
    if (p && !p.flat) {
      for (const n of lower.members) {
        const q = pieces[n];
        if (q && (q.from === p.to || (q.flat && q.to === p.to))) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Crossings when `upper` runs above `lower`: the lower's upper ends that rise through the upper's runs, and the
 * upper's lower ends that fall through the lower's runs.
 */
export function crossingsAbove(
  pieces: readonly ChannelPiece[],
  upper: Hyperedge,
  lower: Hyperedge,
): number {
  let count = 0;
  for (const m of lower.members) {
    const p = pieces[m];
    if (p) {
      count += insideCount(pieces, upper, { x: p.from, probe: p });
      count += p.flat ? insideCount(pieces, upper, { x: p.to, probe: p }) : 0;
    }
  }
  for (const m of upper.members) {
    const p = pieces[m];
    if (p && !p.flat) {
      count += insideCount(pieces, lower, { x: p.to, probe: p });
    }
  }
  return count;
}
