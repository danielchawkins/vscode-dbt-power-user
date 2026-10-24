import type { Route } from "./channels";
import type { Point } from "./layeredMetrics";
import { type Segment, distance, segmentsOf } from "./routeGeometry";

const CORNER_RADIUS = 7;
const HOP = 4.5;

/** The rounding radius at points[i]: at most CORNER_RADIUS, and never more than half of either leg beside it. */
function cornerRadius(points: readonly Point[], i: number): number {
  if (i <= 0 || i >= points.length - 1) {
    return 0;
  }
  const before = points[i - 1] ?? points[i] ?? { x: 0, y: 0 };
  const at = points[i] ?? before;
  const after = points[i + 1] ?? at;
  return Math.min(
    CORNER_RADIUS,
    distance(before, at) / 2,
    distance(at, after) / 2,
  );
}

/** A horizontal run from p0 to p1, and the vertical runs it may hop over. */
interface HorizontalSpan {
  p0: Point;
  p1: Point;
  dir: number;
  r0: number;
  r1: number;
  crossable: readonly (readonly Segment[])[];
}

/** The x of every vertical run a horizontal run from p0 to p1 passes, clear of both corners, in order along it. */
function hopXs({ p0, p1, dir, r0, r1, crossable }: HorizontalSpan): number[] {
  const y = p0.y;
  const hits: number[] = [];
  for (const segments of crossable) {
    for (const [q0, q1] of segments) {
      const x = q0.x;
      const clearOfCorners =
        (x - p0.x) * dir > r0 + HOP + 1 && (p1.x - x) * dir > r1 + HOP + 1;
      if (
        clearOfCorners &&
        y > Math.min(q0.y, q1.y) + 0.5 &&
        y < Math.max(q0.y, q1.y) - 0.5
      ) {
        hits.push(x);
      }
    }
  }
  return hits.sort((u, w) => (u - w) * dir);
}

/** Groups the hop positions of one horizontal run into runs, joining hops that sit within four hops of each other. */
function hopRuns(span: HorizontalSpan): [number, number][] {
  const runs: [number, number][] = [];
  for (const x of hopXs(span)) {
    const last = runs.at(-1);
    if (last && Math.abs(x - last[1]) < 4 * HOP) {
      last[1] = x;
    } else {
      runs.push([x, x]);
    }
  }
  return runs;
}

/** The SVG arc that carries a horizontal run at height y over one hop, from xa to xb. */
function hopArc({
  xa,
  xb,
  y,
  dir,
}: {
  xa: number;
  xb: number;
  y: number;
  dir: number;
}): string {
  const arc = HOP + Math.abs(xb - xa) / 2;
  return ` L${xa - dir * HOP},${y} A${arc},${Math.min(arc, HOP + 1.5)} 0 0 ${dir > 0 ? 1 : 0} ${xb + dir * HOP},${y}`;
}

/** The quadratic curve that rounds the corner at p1, ending r1 along the leg towards p2. */
function cornerCurve(p1: Point, p2: Point, r1: number): string {
  const length2 = distance(p1, p2) || 1;
  return ` Q${p1.x},${p1.y} ${p1.x + ((p2.x - p1.x) / length2) * r1},${p1.y + ((p2.y - p1.y) / length2) * r1}`;
}

/** The rounded path for one route, with a hop wherever a horizontal run crosses another route's vertical run. */
export function drawPath({
  index,
  routes,
  resolved,
  verticals,
  traceOn,
}: {
  index: number;
  routes: readonly Route[];
  resolved: readonly Point[][];
  verticals: readonly (readonly Segment[])[];
  traceOn: boolean;
}): { d: string; hops: number } {
  const points = resolved[index] ?? [];
  const n = points.length;
  const route = routes[index];
  const crossable = verticals.filter(
    (_, j) => j !== index && !(traceOn && route?.kind === "table"),
  );
  const first = points[0] ?? { x: 0, y: 0 };
  let hops = 0;
  let d = `M${first.x},${first.y}`;
  for (let i = 1; i < n; i++) {
    const p0 = points[i - 1] ?? first;
    const p1 = points[i] ?? p0;
    const length = distance(p0, p1) || 1;
    const ux = (p1.x - p0.x) / length;
    const uy = (p1.y - p0.y) / length;
    const r0 = cornerRadius(points, i - 1);
    const r1 = cornerRadius(points, i);
    if (p0.y === p1.y) {
      const dir = Math.sign(ux);
      const runs = hopRuns({ p0, p1, dir, r0, r1, crossable });
      hops += runs.length;
      for (const [xa, xb] of runs) {
        d += hopArc({ xa, xb, y: p0.y, dir });
      }
    }
    d += ` L${p1.x - ux * r1},${p1.y - uy * r1}`;
    if (r1) {
      d += cornerCurve(p1, points[i + 1] ?? p1, r1);
    }
  }
  return { d, hops };
}

export function labelPoint(points: readonly Point[]): Point {
  let best: Segment | undefined;
  let bestLength = -1;
  for (const segment of segmentsOf(points)) {
    const length = distance(segment[0], segment[1]);
    if (length > bestLength) {
      bestLength = length;
      best = segment;
    }
  }
  if (!best) {
    return points[0] ?? { x: 0, y: 0 };
  }
  return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 };
}
