import type { Point } from "./engine/layoutEngine";

export const distance = (p: Point, q: Point): number =>
  Math.hypot(q.x - p.x, q.y - p.y);

export type Segment = readonly [Point, Point];

export const segmentsOf = (points: readonly Point[]): Segment[] =>
  points
    .slice(1)
    .map((point, index) => [points[index] ?? point, point] as const);

export const sameSpot = (p: Point, q: Point): boolean =>
  p.x === q.x && p.y === q.y;

/** A horizontal run: its height and the span of x it covers. */
interface HorizontalRun {
  y: number;
  lo: number;
  hi: number;
}

/** A vertical run: its x and the span of y it covers. */
interface VerticalRun {
  x: number;
  lo: number;
  hi: number;
}

/** Whether a horizontal run crosses a vertical run, strictly inside both. */
function crossesRun(h: HorizontalRun, v: VerticalRun): boolean {
  return (
    v.x > h.lo + 0.5 && v.x < h.hi - 0.5 && h.y > v.lo + 0.5 && h.y < v.hi - 0.5
  );
}

/** A route's runs and the box around them: a crossing lies inside both routes' boxes. */
export interface Geometry {
  horizontal: readonly HorizontalRun[];
  vertical: readonly VerticalRun[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const EMPTY_GEOMETRY: Geometry = {
  horizontal: [],
  vertical: [],
  left: Infinity,
  right: -Infinity,
  top: Infinity,
  bottom: -Infinity,
};

export function geometryOf(points: readonly Point[]): Geometry {
  const horizontal: HorizontalRun[] = [];
  const vertical: VerticalRun[] = [];
  let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [p, q] of segmentsOf(points)) {
    left = Math.min(left, p.x, q.x);
    right = Math.max(right, p.x, q.x);
    top = Math.min(top, p.y, q.y);
    bottom = Math.max(bottom, p.y, q.y);
    if (p.y === q.y) {
      horizontal.push({
        y: p.y,
        lo: Math.min(p.x, q.x),
        hi: Math.max(p.x, q.x),
      });
    }
    if (p.x === q.x) {
      vertical.push({ x: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
    }
  }
  return { horizontal, vertical, left, right, top, bottom };
}

/** The crossings between two routes: each one's horizontal runs over the other's vertical runs. */
export function crossingsBetween(a: Geometry, b: Geometry): number {
  if (
    a.right < b.left ||
    b.right < a.left ||
    a.bottom < b.top ||
    b.bottom < a.top
  ) {
    return 0;
  }
  let count = 0;
  for (const h of a.horizontal) {
    for (const v of b.vertical) {
      count += crossesRun(h, v) ? 1 : 0;
    }
  }
  for (const h of b.horizontal) {
    for (const v of a.vertical) {
      count += crossesRun(h, v) ? 1 : 0;
    }
  }
  return count;
}
