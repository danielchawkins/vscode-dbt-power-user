import type { Point } from "./types.js";

/** An axis-aligned piece of an edge; `from` and `to` are its ends along the varying axis, `from` < `to`. */
export interface Segment {
  horizontal: boolean;
  fixed: number;
  from: number;
  to: number;
}

/** The pieces of one drawn polyline: its axis-aligned segments, its length and its bends. */
export interface Pieces {
  segments: Segment[];
  length: number;
  bends: number;
}

const sameAt = (a: Point | undefined, b: Point | undefined) =>
  a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;

/**
 * Splits a polyline into axis-aligned segments. Repeated points are dropped and points that continue a straight run
 * are merged into it, so a point inside a run is never a segment end. Segments of one line that overlap or touch
 * are joined. A diagonal step adds length and bends but no segment.
 */
export function piecesOf(raw: readonly Point[]): Pieces {
  const points = straightRuns(raw);
  const segments: Segment[] = [];
  let length = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) {
      continue;
    }
    length += Math.hypot(b.x - a.x, b.y - a.y);
    const segment = segmentOf(a, b);
    if (segment) {
      segments.push(segment);
    }
  }
  return {
    segments: joinOnLines(segments),
    length,
    bends: Math.max(0, points.length - 2),
  };
}

/** Drops repeated points, then drops each point that carries on in the direction of the run before it. */
function straightRuns(raw: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of raw) {
    const last = out.at(-1);
    if (sameAt(p, last)) {
      continue;
    }
    const before = out.at(-2);
    if (before && last && continuesRun(before, last, p)) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Whether `c` lies ahead of `b` on the line from `a`: collinear, and not a reversal. */
function continuesRun(a: Point, b: Point, c: Point): boolean {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  return ux * vy - uy * vx === 0 && ux * vx + uy * vy > 0;
}

function segmentOf(a: Point, b: Point): Segment | undefined {
  if (a.y === b.y) {
    return {
      horizontal: true,
      fixed: a.y,
      from: Math.min(a.x, b.x),
      to: Math.max(a.x, b.x),
    };
  }
  if (a.x === b.x) {
    return {
      horizontal: false,
      fixed: a.x,
      from: Math.min(a.y, b.y),
      to: Math.max(a.y, b.y),
    };
  }
  return undefined;
}

/** Joins the segments of one line that overlap or touch, so a point of the line lies in at most one segment. */
function joinOnLines(segments: readonly Segment[]): Segment[] {
  const ordered = segments.toSorted(
    (a, b) =>
      Number(a.horizontal) - Number(b.horizontal) ||
      a.fixed - b.fixed ||
      a.from - b.from,
  );
  const joined: Segment[] = [];
  for (const s of ordered) {
    const last = joined.at(-1);
    if (
      last &&
      last.horizontal === s.horizontal &&
      last.fixed === s.fixed &&
      s.from <= last.to
    ) {
      last.to = Math.max(last.to, s.to);
    } else {
      joined.push(s);
    }
  }
  return joined;
}

/** Whether a segment runs through the interior of an axis-aligned box; touching its edges does not count. */
export function entersBox(
  s: Segment,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  if (s.horizontal) {
    return (
      s.fixed > box.y && s.fixed < bottom && s.from < right && s.to > box.x
    );
  }
  return s.fixed > box.x && s.fixed < right && s.from < bottom && s.to > box.y;
}
