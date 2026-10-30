import { ascending, sortedInInputOrder } from "./comparators.js";
import {
  entersBox,
  type Pieces,
  piecesOf,
  type Segment,
} from "./drawingSegments.js";
import { Fenwick } from "./fenwick.js";
import { breachesOf } from "./opaque.js";
import type { LayoutMetrics, Point, Rect } from "./types.js";

/** One edge as drawn: its polyline from the source end to the target end, and the two nodes it joins. */
export interface DrawnPath {
  points: readonly Point[];
  source: string;
  target: string;
}

/** A drawing to measure: node boxes and edge polylines, each keyed by id. */
export interface Drawing {
  boxes: ReadonlyMap<string, Rect>;
  paths: ReadonlyMap<string, DrawnPath>;
  /**
   * The trunk of an edge, such as its source port. Edges with the same trunk never count as crossing each other;
   * an edge with no trunk (undefined) shares one with no other edge.
   */
  trunkOf?: (edge: string) => string | undefined;
  /** Ranks by node id; `compareDrawings` counts rank changes when both drawings carry them. */
  ranks?: ReadonlyMap<string, number>;
  /**
   * The opaque boxes, by cluster id, and for each edge the boxes it may enter (those holding one of its ends). An edge
   * with no entry may enter none. Without `opaque`, `opaqueBreaches` is zero.
   */
  opaque?: {
    boxes: ReadonlyMap<string, Rect>;
    allowed: ReadonlyMap<string, ReadonlySet<string>>;
  };
}

export interface CompareOptions {
  /** A node both drawings hold. `after` is shifted so the anchor's centre matches its centre in `before`. */
  anchor?: string;
  /** The direction ranks run; rank bands are the rows (down) or the columns (right). Defaults to `down`. */
  direction?: "down" | "right";
}

export interface DrawingComparison {
  /** Nodes present in both drawings. */
  retained: number;
  meanDisplacement: number;
  maxDisplacement: number;
  /** Pairs of retained nodes that overlap on the rank axis in both drawings and whose order flipped. */
  orderFlips: number;
  /** Retained nodes whose rank changed; undefined unless both drawings carry ranks. */
  rankChanges?: number;
}

/** The pieces of one edge, with its id. */
type PiecesOf = Pieces & { id: string };

/**
 * Measures a drawing: crossings, bends, edge length, bounds area, density and overlaps. Crossings count proper
 * interior intersections of pieces of different edges that do not share a trunk. Overlaps count node pairs sharing
 * interior area, plus edge and node pairs where a piece of the edge runs through a node it does not end at.
 */
export function measureDrawing(drawing: Drawing): LayoutMetrics {
  const pieces = Array.from(drawing.paths, ([id, path]) => ({
    id,
    ...piecesOf(path.points),
  }));
  const bounds = boundsOf(drawing);
  const area = bounds.width * bounds.height;
  const nodeArea = [...drawing.boxes.values()].reduce(
    (sum, box) => sum + box.width * box.height,
    0,
  );
  return {
    crossings: countCrossings(pieces, drawing.trunkOf),
    bends: pieces.reduce((sum, p) => sum + p.bends, 0),
    edgeLength: pieces.reduce((sum, p) => sum + p.length, 0),
    area,
    density: area > 0 ? nodeArea / area : 0,
    overlaps: nodeOverlaps(drawing.boxes) + edgeNodeOverlaps(drawing, pieces),
    opaqueBreaches: opaqueBreaches(drawing),
  };
}

/**
 * Pairs of an edge and an opaque box it may not enter, where the edge runs through the box or within the clearance of
 * its border (`breachesOf`).
 */
function opaqueBreaches(drawing: Drawing): number {
  if (!drawing.opaque) {
    return 0;
  }
  const { boxes, allowed } = drawing.opaque;
  let count = 0;
  for (const [id, path] of drawing.paths) {
    count += breachesOf(
      path.points,
      boxes,
      allowed.get(id) ?? new Set<string>(),
    ).length;
  }
  return count;
}

/**
 * How much a drawing changed from `before` to `after`: displacement of the nodes both hold, measured after the
 * anchor is moved onto itself; order flips between nodes in one rank band; and rank changes.
 */
export function compareDrawings(
  before: Drawing,
  after: Drawing,
  options: CompareOptions = {},
): DrawingComparison {
  const shared = [...before.boxes.keys()].filter((id) => after.boxes.has(id));
  const offset = anchorOffset(before, after, options.anchor);
  const displacements = shared.map((id) => {
    const a = centreOf(before.boxes.get(id));
    const b = centreOf(after.boxes.get(id));
    return Math.hypot(b.x - a.x - offset.x, b.y - a.y - offset.y);
  });
  const total = displacements.reduce((sum, d) => sum + d, 0);
  return {
    retained: shared.length,
    meanDisplacement: shared.length > 0 ? total / shared.length : 0,
    maxDisplacement: maxOf(displacements),
    orderFlips: orderFlips(before, after, {
      shared,
      rankAxisIsY: (options.direction ?? "down") === "down",
    }),
    ...rankChangesOf(before, after, shared),
  };
}

/** Largest of the values, or zero. A loop: spreading a long array into `Math.max` overflows the call stack. */
function maxOf(values: readonly number[]): number {
  let max = 0;
  for (const v of values) {
    if (v > max) {
      max = v;
    }
  }
  return max;
}

function rankChangesOf(
  before: Drawing,
  after: Drawing,
  shared: readonly string[],
): { rankChanges?: number } {
  if (!before.ranks || !after.ranks) {
    return {};
  }
  const ranksBefore = before.ranks;
  const ranksAfter = after.ranks;
  const changed = shared.filter((id) => {
    const a = ranksBefore.get(id);
    const b = ranksAfter.get(id);
    return a !== undefined && b !== undefined && a !== b;
  });
  return { rankChanges: changed.length };
}

/**
 * Crossings between pieces of edges that do not share a trunk. One sweep counts the pairs among all pieces; the pairs
 * inside each trunk group (an edge alone when it has no trunk) are then taken back, each group by its own sweep. The
 * sweeps cover every piece once, so the total stays O(S log S).
 */
function countCrossings(
  pieces: readonly PiecesOf[],
  trunkOf: Drawing["trunkOf"],
): number {
  let total = sweepCrossings(pieces.flatMap((p) => p.segments));
  for (const group of trunkGroups(pieces, trunkOf)) {
    total -= sweepCrossings(group);
  }
  return total;
}

/** The segments of each trunk group; an edge with no trunk forms a group of its own. */
function trunkGroups(
  pieces: readonly PiecesOf[],
  trunkOf: Drawing["trunkOf"],
): Segment[][] {
  const byTrunk = new Map<string, Segment[]>();
  const untrunked: Segment[][] = [];
  for (const piece of pieces) {
    const trunk = trunkOf?.(piece.id);
    if (trunk === undefined) {
      untrunked.push(piece.segments);
      continue;
    }
    const group = byTrunk.get(trunk) ?? [];
    for (const s of piece.segments) {
      group.push(s);
    }
    byTrunk.set(trunk, group);
  }
  return [...byTrunk.values(), ...untrunked];
}

/**
 * Pairs of a horizontal and a vertical segment that cross properly, by a left-to-right sweep: a horizontal segment is
 * live between its ends, and each vertical segment counts the live ones whose height lies strictly inside its span.
 */
function sweepCrossings(all: readonly Segment[]): number {
  const heights = [
    ...new Set(all.filter((s) => s.horizontal).map((s) => s.fixed)),
  ].sort(ascending);
  const tree = new Fenwick(heights.length);
  let total = 0;
  for (const event of sweepEvents(all, heights)) {
    if (event.kind === "live") {
      tree.add(event.row, event.delta);
      continue;
    }
    const lo = firstAbove(heights, event.low);
    const hi = firstAtLeast(heights, event.high);
    total += hi > lo ? tree.prefix(hi) - tree.prefix(lo) : 0;
  }
  return total;
}

type SweepEvent =
  | { kind: "live"; x: number; order: number; row: number; delta: number }
  | { kind: "query"; x: number; order: number; low: number; high: number };

/** Removals first, then queries, then insertions at each x, so a piece never counts at its own end. */
function sweepEvents(
  all: readonly Segment[],
  heights: readonly number[],
): SweepEvent[] {
  const events: SweepEvent[] = [];
  for (const s of all) {
    if (s.horizontal) {
      const row = firstAtLeast(heights, s.fixed);
      events.push({ kind: "live", x: s.from, order: 2, row, delta: 1 });
      events.push({ kind: "live", x: s.to, order: 0, row, delta: -1 });
    } else {
      events.push({
        kind: "query",
        x: s.fixed,
        order: 1,
        low: s.from,
        high: s.to,
      });
    }
  }
  return sortedInInputOrder(events, [(e) => e.x, (e) => e.order]);
}

/** Index of the first height above `value`. */
function firstAbove(heights: readonly number[], value: number): number {
  return countWhile(heights, (h) => h <= value);
}

/** Index of the first height not below `value`. */
function firstAtLeast(heights: readonly number[], value: number): number {
  return countWhile(heights, (h) => h < value);
}

/** Binary search: the number of leading heights for which `below` holds. */
function countWhile(
  heights: readonly number[],
  below: (height: number) => boolean,
): number {
  let lo = 0;
  let hi = heights.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (below(heights[mid] ?? 0)) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** The smallest rectangle holding every box and every point. Loops, so a long path cannot overflow the call stack. */
function boundsOf(drawing: Drawing): Rect {
  const extent = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const include = (x: number, y: number) => {
    extent.minX = Math.min(extent.minX, x);
    extent.minY = Math.min(extent.minY, y);
    extent.maxX = Math.max(extent.maxX, x);
    extent.maxY = Math.max(extent.maxY, y);
  };
  for (const box of drawing.boxes.values()) {
    include(box.x, box.y);
    include(box.x + box.width, box.y + box.height);
  }
  for (const path of drawing.paths.values()) {
    for (const p of path.points) {
      include(p.x, p.y);
    }
  }
  if (extent.minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: extent.minX,
    y: extent.minY,
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY,
  };
}

/** Pairs of nodes whose boxes share interior area. */
function nodeOverlaps(boxes: ReadonlyMap<string, Rect>): number {
  const list = [...boxes.values()];
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a && b && sharesArea(a, b)) {
        count++;
      }
    }
  }
  return count;
}

function sharesArea(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Pairs of an edge and a node it does not end at, where a piece of the edge runs through the node. */
function edgeNodeOverlaps(
  drawing: Drawing,
  pieces: readonly PiecesOf[],
): number {
  return pieces.reduce(
    (sum, piece) => sum + nodesRunThrough(drawing, piece),
    0,
  );
}

function nodesRunThrough(drawing: Drawing, piece: PiecesOf): number {
  const path = drawing.paths.get(piece.id);
  if (!path) {
    return 0;
  }
  return [...drawing.boxes].filter(
    ([id, box]) =>
      id !== path.source &&
      id !== path.target &&
      piece.segments.some((s) => entersBox(s, box)),
  ).length;
}

function centreOf(box: Rect | undefined): Point {
  return {
    x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
    y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
  };
}

/** The shift that brings the anchor of `before` onto the anchor of `after`; zero without a shared anchor. */
function anchorOffset(
  before: Drawing,
  after: Drawing,
  anchor: string | undefined,
): Point {
  const a = anchor === undefined ? undefined : before.boxes.get(anchor);
  const b = anchor === undefined ? undefined : after.boxes.get(anchor);
  if (!a || !b) {
    return { x: 0, y: 0 };
  }
  const ca = centreOf(a);
  const cb = centreOf(b);
  return { x: cb.x - ca.x, y: cb.y - ca.y };
}

/**
 * Pairs retained in both drawings that overlap along the rank axis, in both, and whose order across the axis flipped.
 * A node that changes rank therefore stops overlapping its old band-mates and cannot flip with them.
 */
function orderFlips(
  before: Drawing,
  after: Drawing,
  axes: { shared: readonly string[]; rankAxisIsY: boolean },
): number {
  const { shared, rankAxisIsY } = axes;
  const along = (box: Rect) =>
    rankAxisIsY
      ? { lo: box.y, hi: box.y + box.height }
      : { lo: box.x, hi: box.x + box.width };
  const across = (box: Rect) =>
    rankAxisIsY ? box.x + box.width / 2 : box.y + box.height / 2;
  let flips = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const b1 = before.boxes.get(shared[i] ?? "");
      const b2 = before.boxes.get(shared[j] ?? "");
      const a1 = after.boxes.get(shared[i] ?? "");
      const a2 = after.boxes.get(shared[j] ?? "");
      if (!b1 || !b2 || !a1 || !a2) {
        continue;
      }
      if (
        !overlapsAlong(along(b1), along(b2)) ||
        !overlapsAlong(along(a1), along(a2))
      ) {
        continue;
      }
      const beforeSign = Math.sign(across(b1) - across(b2));
      const afterSign = Math.sign(across(a1) - across(a2));
      if (beforeSign !== 0 && afterSign !== 0 && beforeSign !== afterSign) {
        flips++;
      }
    }
  }
  return flips;
}

function overlapsAlong(
  a: { lo: number; hi: number },
  b: { lo: number; hi: number },
): boolean {
  return Math.min(a.hi, b.hi) > Math.max(a.lo, b.lo);
}
