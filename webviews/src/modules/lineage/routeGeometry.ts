import type { Point } from "./engine/layoutEngine";

export const distance = (p: Point, q: Point): number =>
  Math.hypot(q.x - p.x, q.y - p.y);

export type Segment = readonly [Point, Point];

export const segmentsOf = (points: readonly Point[]): Segment[] =>
  points
    .slice(1)
    .map((point, index) => [points[index] ?? point, point] as const);
