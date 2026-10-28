import type { Point } from "../types.js";
import type { Member, Run } from "./pieces.js";

/** The drawing's frame and the stacked ranks that polylines are built against. */
export interface Geometry {
  down: boolean;
  /** Space between two tracks. */
  edge: number;
  /** Across-axis centre of each rank, after the band widths are known. */
  centres: readonly number[];
  /** Half the across extent of each rank's tallest node. */
  halves: readonly number[];
  /** Half the across extent of each layered node; zero for a dummy. */
  nodeHalves: readonly number[];
  /**
   * For a lateral port's dummy, the across coordinate of its port relative to its rank's centre; undefined for any
   * other node.
   */
  portAcross: readonly (number | undefined)[];
  /** The rank of each layered node. */
  ranks: readonly number[];
}

/**
 * The orthogonal polyline of each member, from its source end to its target end: down from each upper end to its
 * track, across the track to the lower end's in-rank coordinate, and on to the lower end. Repeated and collinear
 * points are dropped, so each polyline keeps only its bends.
 */
export function polylinesOf(
  members: readonly Member[],
  geometry: Geometry,
): Map<string, Point[]> {
  return new Map(
    members.map((member) => [member.edge, pathOf(member, geometry)] as const),
  );
}

/** A point given its in-rank coordinate and its across coordinate, in the drawing's frame. */
export function framePoint(
  down: boolean,
  inRank: number,
  across: number,
): Point {
  return down ? { x: inRank, y: across } : { x: across, y: inRank };
}

/** The across coordinate of a layered node's side that faces the band below it (`down`) or above it. */
function acrossOf(geometry: Geometry, node: number, down: boolean): number {
  const rank = geometry.ranks[node] ?? 0;
  const centre = geometry.centres[rank] ?? 0;
  const port = geometry.portAcross[node];
  if (port !== undefined) {
    return centre + port;
  }
  const half = geometry.nodeHalves[node] ?? 0;
  return down ? centre + half : centre - half;
}

/** The points of a run's track: across its track from its upper end's column, through its dogleg if it has one. */
function trackPoints(run: Run, bandTop: number, geometry: Geometry): Point[] {
  const at = (track: number): number => bandTop + (track + 1) * geometry.edge;
  const y = at(run.track);
  const down = geometry.down;
  if (run.jog === undefined) {
    return [framePoint(down, run.from, y), framePoint(down, run.to, y)];
  }
  const next = at(run.jog.track);
  return [
    framePoint(down, run.from, y),
    framePoint(down, run.jog.at, y),
    framePoint(down, run.jog.at, next),
    framePoint(down, run.to, next),
  ];
}

function pathOf(member: Member, geometry: Geometry): Point[] {
  const points: Point[] = [];
  for (const run of member.runs) {
    const band = geometry.centres[run.rank] ?? 0;
    const bandTop = band + (geometry.halves[run.rank] ?? 0);
    if (run.upperStub !== undefined) {
      points.push(
        framePoint(
          geometry.down,
          run.upperStub,
          acrossOf(geometry, run.upper, true),
        ),
      );
    }
    points.push(
      framePoint(geometry.down, run.from, acrossOf(geometry, run.upper, true)),
    );
    if (run.track >= 0) {
      points.push(...trackPoints(run, bandTop, geometry));
    }
    points.push(
      framePoint(
        geometry.down,
        run.to,
        acrossOf(geometry, run.lower, run.flat),
      ),
    );
    if (run.lowerStub !== undefined) {
      points.push(
        framePoint(
          geometry.down,
          run.lowerStub,
          acrossOf(geometry, run.lower, run.flat),
        ),
      );
    }
  }
  const simple = withoutBends(points);
  return member.reversed ? simple.reverse() : simple;
}

/** Drops each point that repeats the one before it, or that lies on the line through its neighbours. */
function withoutBends(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && last.x === p.x && last.y === p.y) {
      continue;
    }
    const before = out.at(-2);
    if (
      before !== undefined &&
      last !== undefined &&
      onOneLine(before, last, p)
    ) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

function onOneLine(a: Point, b: Point, c: Point): boolean {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
}
