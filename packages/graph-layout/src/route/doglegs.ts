/**
 * Doglegs (Deutsch, DAC 1976) within one band. A run that is the only member of its hyperedge may jog: it leaves its
 * upper end on its track, runs across to an in-rank column, drops or rises to a second track and runs on to its lower
 * end. A jog is kept only where it lowers the crossings plus touches the run makes with the other pieces, and neither
 * count rises, measured on the segments as they are drawn. So the band's crossing count stays exact and never grows.
 * Pieces are visited once each, in order.
 */

import { crossable } from "./channelCrossings.js";
import { type Segment, meet, segmentsOf } from "./channelSegments.js";
import type { ChannelPiece, Jog } from "./channelTypes.js";

/** Pieces' current drawn segments, indexed as the pieces are. */
interface Drawing {
  pieces: readonly ChannelPiece[];
  segments: readonly (readonly Segment[])[];
}

/** Crossings and touches a piece makes with the others: a touch is an overlap of two segments on one line. */
interface Cost {
  crossings: number;
  touches: number;
}

export interface DoglegOptions {
  pieces: readonly ChannelPiece[];
  /** The track each piece has, counted from the upper edge; -1 for a straight piece, which has none. */
  tracks: readonly number[];
  /** Whether each piece is the only member of its hyperedge, so that it may jog without splitting a star. */
  solo: readonly boolean[];
  /** Tracks the band has before any jog. */
  trackCount: number;
  /** Most piece pairs to test over the band; past it no further jog is tried. */
  work: number;
}

export interface DoglegRouting {
  /** The jog of each piece, if it has one. */
  jogs: (Jog | undefined)[];
  /** Tracks the band needs with the jogs: a jog may use a track below all the others. */
  trackCount: number;
  /** Change in crossings the jogs make; never positive. */
  crossings: number;
}

/** The search's state: tracks the band has, the work spent against its limit, and the band's in-rank columns. */
interface Search {
  trackCount: number;
  work: number;
  limit: number;
  columns: readonly number[];
}

/** A jog that lowers a run's crossings plus touches, with the change it makes to the band's crossings. */
interface Found {
  jog: Jog;
  segments: Segment[];
  crossings: number;
}

/** Gives the solo runs whose straight form crosses or touches others the jog that lowers that count, if any. */
export function addDoglegs(options: DoglegOptions): DoglegRouting {
  const { pieces, solo, tracks } = options;
  const drawing: Drawing = {
    pieces,
    segments: pieces.map((p, i) => segmentsOf(p, tracks[i] ?? -1, undefined)),
  };
  const jogs: (Jog | undefined)[] = pieces.map(() => undefined);
  const search: Search = {
    trackCount: options.trackCount,
    work: 0,
    limit: options.work,
    columns: columnsOf(pieces),
  };
  let crossings = 0;
  pieces.forEach((_, i) => {
    const track = tracks[i] ?? -1;
    if (track < 0 || !solo[i] || search.work > search.limit) {
      return;
    }
    const found = bestJog(drawing, { index: i, track }, search);
    if (found === undefined) {
      return;
    }
    drawing.segments = drawing.segments.map((s, j) =>
      j === i ? found.segments : s,
    );
    jogs[i] = found.jog;
    crossings += found.crossings;
    search.trackCount = Math.max(search.trackCount, found.jog.track + 1);
  });
  return { jogs, trackCount: search.trackCount, crossings };
}

/**
 * The jog of a run that lowers its crossings plus touches, and neither count rises, or undefined when no jog does.
 * Jogs are tried in order and the first lowest-scoring one wins.
 */
function bestJog(
  drawing: Drawing,
  run: { index: number; track: number },
  search: Search,
): Found | undefined {
  const p = drawing.pieces[run.index];
  if (p === undefined) {
    return undefined;
  }
  search.work += drawing.pieces.length;
  const here = costAt(drawing, run.index, drawing.segments[run.index] ?? []);
  let bestScore = here.crossings + here.touches;
  let best: Found | undefined;
  for (const jog of jogsFor(p, run.track, search)) {
    if (search.work > search.limit || bestScore === 0) {
      break;
    }
    search.work += drawing.pieces.length;
    const segments = segmentsOf(p, run.track, jog);
    const cost = costAt(drawing, run.index, segments);
    const score = cost.crossings + cost.touches;
    if (
      score < bestScore &&
      cost.crossings <= here.crossings &&
      cost.touches <= here.touches
    ) {
      bestScore = score;
      best = {
        jog,
        segments,
        crossings: cost.crossings - here.crossings,
      };
    }
  }
  return best;
}

/** The in-rank columns of a band, sorted: every run end, and the midpoint between each neighbouring pair. */
function columnsOf(pieces: readonly ChannelPiece[]): number[] {
  const coordinates = [...new Set(pieces.flatMap((q) => [q.from, q.to]))].sort(
    (a, b) => a - b,
  );
  return coordinates.flatMap((x, k) => {
    const next = coordinates[k + 1];
    return next === undefined ? [x] : [x, (x + next) / 2];
  });
}

/** The jogs worth trying for a run, lazily: each column strictly inside its span, on each other track. */
function* jogsFor(
  p: ChannelPiece,
  track: number,
  search: Search,
): Generator<Jog> {
  const lo = Math.min(p.from, p.to);
  const hi = Math.max(p.from, p.to);
  for (const at of search.columns) {
    if (at <= lo || at >= hi) {
      continue;
    }
    for (let t = 0; t <= search.trackCount; t++) {
      if (t !== track) {
        yield { at, track: t };
      }
    }
  }
}

/** The crossings and touches of piece `i`, drawn with `mine`, against every other piece's drawn segments. */
function costAt(drawing: Drawing, i: number, mine: readonly Segment[]): Cost {
  const cost: Cost = { crossings: 0, touches: 0 };
  const self = drawing.pieces[i];
  if (self === undefined) {
    return cost;
  }
  drawing.pieces.forEach((q, j) => {
    if (j === i || !crossable(self, q)) {
      return;
    }
    for (const a of mine) {
      for (const b of drawing.segments[j] ?? []) {
        const met = meet(a, b);
        if (met === "crossing") {
          cost.crossings++;
        } else if (met === "touch") {
          cost.touches++;
        }
      }
    }
  });
  return cost;
}
