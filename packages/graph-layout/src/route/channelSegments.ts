/**
 * The axis-parallel segments a band's runs are drawn with, and how two of them meet: a crossing, a touch (an overlap on
 * one line), or nothing. A run is down from its upper end to its track, across, and down to its lower end; a straight
 * run is one vertical through the band. Doglegs are measured with these, as `measureDrawing` counts crossings.
 */

import type { ChannelPiece, Jog } from "./channelTypes.js";

/** Below every track: a vertical that reaches the band's lower edge stops here. */
const BOTTOM = Number.POSITIVE_INFINITY;
/** Above every track: a vertical that starts on the band's upper edge. */
const TOP = -1;

/** An axis-parallel segment of a piece: a horizontal at `fixed` = y, or a vertical at `fixed` = x. */
export interface Segment {
  horizontal: boolean;
  fixed: number;
  lo: number;
  hi: number;
}

/**
 * The segments of a run: down from its upper end to its track, across the track, down to its lower end. With a jog,
 * the run crosses to the jog's column and continues on the jog's track. A straight run is one vertical through the band.
 */
export function segmentsOf(
  p: ChannelPiece,
  track: number,
  jog: Jog | undefined,
): Segment[] {
  if (track < 0 || (!p.flat && p.from === p.to && jog === undefined)) {
    return [vertical(p.from, TOP, BOTTOM)];
  }
  const far = p.flat ? TOP : BOTTOM;
  if (jog === undefined) {
    return [
      vertical(p.from, TOP, track),
      horizontal(track, p.from, p.to),
      vertical(p.to, track, far),
    ];
  }
  return [
    vertical(p.from, TOP, track),
    horizontal(track, p.from, jog.at),
    vertical(jog.at, track, jog.track),
    horizontal(jog.track, jog.at, p.to),
    vertical(p.to, jog.track, far),
  ];
}

function horizontal(y: number, x1: number, x2: number): Segment {
  return {
    horizontal: true,
    fixed: y,
    lo: Math.min(x1, x2),
    hi: Math.max(x1, x2),
  };
}

function vertical(x: number, y1: number, y2: number): Segment {
  return {
    horizontal: false,
    fixed: x,
    lo: Math.min(y1, y2),
    hi: Math.max(y1, y2),
  };
}

/**
 * Whether two segments cross (a horizontal strictly inside a vertical's span, and the reverse), or overlap on one line
 * over a positive length. Ends that meet only at a point do not count.
 */
export function meet(a: Segment, b: Segment): "crossing" | "touch" | undefined {
  if (a.horizontal === b.horizontal) {
    return a.fixed === b.fixed && Math.min(a.hi, b.hi) > Math.max(a.lo, b.lo)
      ? "touch"
      : undefined;
  }
  const h = a.horizontal ? a : b;
  const v = a.horizontal ? b : a;
  return h.lo < v.fixed && v.fixed < h.hi && v.lo < h.fixed && h.fixed < v.hi
    ? "crossing"
    : undefined;
}
