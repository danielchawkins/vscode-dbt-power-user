/**
 * Gutter router for the layered lineage layout. Every edge is routed at once through channels: a horizontal gutter
 * between each pair of rows, the corridor above and below the start node, a narrow lane beside each card for column
 * edges, and an outer channel on each side for an edge that must pass the start node's row without touching it.
 *
 * Each channel hands its edges evenly spaced tracks, in list order. The list order is improved greedily to remove
 * crossings. Crossings that remain are drawn as hops: the horizontal run arcs over the vertical one.
 *
 * Pure functions: boxes in, SVG path strings out.
 */
import { BAND_PAD, CARD_GAP, CORRIDOR, GUTTER, type Point } from "./layered";
import { geometry as cardGeometry } from "./layout";

interface RouteBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A dbt edge: the parent's child bubble to the child's parent bubble. */
export interface TableRoute {
  id: string;
  parent: string;
  child: string;
}

/** A column edge, leaving the source card on its right and entering the target card on its left. */
interface ColumnRoute {
  id: string;
  from: string;
  fromY: number;
  to: string;
  toY: number;
}

/** A declared relationship between two cards, joined through the left part of their top or bottom edge. */
export interface RelationshipRoute {
  id: string;
  from: string;
  to: string;
}

export interface RouteInput {
  focus: string;
  boxes: ReadonlyMap<string, RouteBox>;
  /** Sub-row index of every card, counted from the top. */
  rowOf: ReadonlyMap<string, number>;
  /** Generation of every card from the start node, used to tell a one-generation step from a longer span. */
  generation: ReadonlyMap<string, number>;
  /** Horizontal extent of the layered (non-Other) cards. */
  layeredBounds: { left: number; right: number };
  tableRoutes: readonly TableRoute[];
  columnRoutes: readonly ColumnRoute[];
  relationshipRoutes: readonly RelationshipRoute[];
  /** A column trace is shown: table edges then never hop, and crossings with them count a tenth. */
  traceOn: boolean;
}

export interface RoutedPath {
  d: string;
  /** The middle of the path's longest run, where a label sits. */
  labelAt: Point;
  /** The first and last points of the path: the card edges it leaves and enters. */
  start: Point;
  end: Point;
  /** A relationship's path: the card it starts at, which is its upper card, or `from` when both share a row. */
  startsAt?: string | undefined;
}

export interface RouteResult {
  paths: Map<string, RoutedPath>;
  crossings: number;
  hops: number;
}

type Kind = "table" | "rel" | "col";
/** A coordinate: a number, or the name of a channel that assigns it per route. */
type Coord = number | string;
type Stop = readonly [Coord, Coord];
type Segment = readonly [Point, Point];

interface Route {
  id: string;
  kind: Kind;
  /** Tie-breaker for the initial channel order: where the route ends, left to right. */
  other: number;
  /** Position in the order the routes were added; the search keys its per-route tables by it. */
  index: number;
  stops: readonly Stop[];
  /** A relationship route's first card, which its path starts at. */
  startsAt?: string;
}

type RouteSpec = Omit<Route, "stops" | "index">;

interface Channel {
  lo: number;
  hi: number;
  routes: Route[];
}

/** Bounds the greedy search so a large graph still answers quickly. */
const EVALUATION_BUDGET = 2000;
const CORNER_RADIUS = 7;
const HOP = 4.5;
const RELATIONSHIP_LEFT = 12;
const RELATIONSHIP_WIDTH = 64;

const isChannel = (coord: Coord): coord is string => typeof coord === "string";

const distance = (p: Point, q: Point): number =>
  Math.hypot(q.x - p.x, q.y - p.y);

const segmentsOf = (points: readonly Point[]): Segment[] =>
  points
    .slice(1)
    .map((point, index) => [points[index] ?? point, point] as const);

const sameSpot = (p: Point, q: Point): boolean => p.x === q.x && p.y === q.y;

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
interface Geometry {
  horizontal: readonly HorizontalRun[];
  vertical: readonly VerticalRun[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const EMPTY_GEOMETRY: Geometry = {
  horizontal: [],
  vertical: [],
  left: Infinity,
  right: -Infinity,
  top: Infinity,
  bottom: -Infinity,
};

function geometryOf(points: readonly Point[]): Geometry {
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
function crossingsBetween(a: Geometry, b: Geometry): number {
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

/** The search's state: the crossing count in tenths, every route's geometry by index, and the pair costs. */
interface SearchState {
  best: number;
  evaluations: number;
  traceOn: boolean;
  geometry: Geometry[];
  /** Weighted crossings of each pair in tenths, at `i * routes + j`; symmetric. */
  costs: number[];
}

/** The total of all pair costs, each pair counted once. */
const totalOf = (costs: readonly number[]): number =>
  costs.reduce((sum, cost) => sum + cost, 0) / 2;

class Channels {
  private readonly byName = new Map<string, Channel>();
  readonly routes: Route[] = [];

  channel(name: string, lo: number, hi: number): string {
    if (!this.byName.has(name)) {
      this.byName.set(name, { lo, hi, routes: [] });
    }
    return name;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  bounds(name: string): { lo: number; hi: number } {
    const channel = this.byName.get(name);
    return channel ? { lo: channel.lo, hi: channel.hi } : { lo: 0, hi: 0 };
  }

  add(spec: RouteSpec, stops: readonly Stop[]): void {
    const route: Route = { ...spec, index: this.routes.length, stops };
    for (const [x, y] of stops) {
      for (const coord of [x, y]) {
        if (!isChannel(coord)) {
          continue;
        }
        const channel = this.byName.get(coord);
        if (channel && !channel.routes.includes(route)) {
          channel.routes.push(route);
        }
      }
    }
    this.routes.push(route);
  }

  /** The coordinate of a route inside a channel: tracks split the channel evenly, in list order. */
  private position(name: string, route: Route): number {
    const channel = this.byName.get(name);
    if (!channel) {
      return 0;
    }
    const count = channel.routes.length;
    if (count === 1) {
      return (channel.lo + channel.hi) / 2;
    }
    const index = channel.routes.indexOf(route);
    return channel.lo + ((channel.hi - channel.lo) * (index + 0.5)) / count;
  }

  resolve(route: Route): Point[] {
    const at = (coord: Coord): number =>
      isChannel(coord) ? this.position(coord, route) : coord;
    const points = route.stops.map(([x, y]) => ({ x: at(x), y: at(y) }));
    return points.filter(
      (point, index) =>
        index === 0 || !sameSpot(point, points[index - 1] ?? point),
    );
  }

  /**
   * A crossing between two routes of different kinds costs a tenth under a trace. Weights are in tenths, so sums are
   * exact.
   */
  private weight(first: Route, second: Route, traceOn: boolean): number {
    return traceOn && first.kind !== second.kind ? 1 : 10;
  }

  crossings(traceOn: boolean): number {
    return totalOf(this.pairCosts(this.geometries(), traceOn)) / 10;
  }

  /** Every route's geometry under the current track positions, by index. */
  private geometries(): Geometry[] {
    return this.routes.map((route) => geometryOf(this.resolve(route)));
  }

  /** The weighted crossings between every pair of routes, in tenths, at `i * routes + j`. */
  private pairCosts(geometry: readonly Geometry[], traceOn: boolean): number[] {
    const size = this.routes.length;
    const costs = new Array<number>(size * size).fill(0);
    for (const first of this.routes) {
      for (const second of this.routes) {
        if (second.index <= first.index) {
          continue;
        }
        const cost =
          this.weight(first, second, traceOn) *
          crossingsBetween(
            geometry[first.index] ?? EMPTY_GEOMETRY,
            geometry[second.index] ?? EMPTY_GEOMETRY,
          );
        costs[first.index * size + second.index] = cost;
        costs[second.index * size + first.index] = cost;
      }
    }
    return costs;
  }

  /** Starts each channel in the order its edges end, then moves one edge at a time while that removes crossings. */
  optimise(traceOn: boolean): void {
    const channels = [...this.byName.values()];
    for (const channel of channels) {
      channel.routes.sort((p, q) => p.other - q.other);
    }
    const geometry = this.geometries();
    const costs = this.pairCosts(geometry, traceOn);
    const search: SearchState = {
      best: totalOf(costs),
      evaluations: 0,
      traceOn,
      geometry,
      costs,
    };
    for (let pass = 0; pass < 12 && search.best > 0; pass++) {
      let improved = false;
      for (const channel of channels) {
        if (this.sweep(channel.routes, search)) {
          improved = true;
        }
      }
      if (!improved) {
        break;
      }
    }
  }

  /** Tries every route in one channel at every other slot; returns whether any move was kept. */
  private sweep(routes: Route[], search: SearchState): boolean {
    let improved = false;
    for (let i = 0; i < routes.length; i++) {
      for (let j = 0; j < routes.length; j++) {
        if (i === j || search.evaluations >= EVALUATION_BUDGET) {
          continue;
        }
        search.evaluations++;
        if (this.tryMove(routes, i, j, search)) {
          improved = true;
        }
      }
    }
    return improved;
  }

  /**
   * Moves the route at `from` to slot `to` if that lowers the crossing count. A move shifts the track of every route
   * between the two slots, so only those routes and the pairs they make are recounted.
   */
  private tryMove(
    routes: Route[],
    from: number,
    to: number,
    search: SearchState,
  ): boolean {
    const changed = routes.slice(Math.min(from, to), Math.max(from, to) + 1);
    const [route] = routes.splice(from, 1);
    if (!route) {
      return false;
    }
    routes.splice(to, 0, route);
    const size = this.routes.length;
    const pending: (Geometry | undefined)[] = [];
    for (const r of changed) {
      pending[r.index] = geometryOf(this.resolve(r));
    }
    const geometryNow = (index: number): Geometry =>
      pending[index] ?? search.geometry[index] ?? EMPTY_GEOMETRY;

    // Each pair with a changed route is priced once; a pair of two changed routes is priced at the earlier one.
    const rank: (number | undefined)[] = [];
    changed.forEach((r, position) => {
      rank[r.index] = position;
    });
    const updates: [number, number, number][] = [];
    let delta = 0;
    changed.forEach((first, position) => {
      for (const second of this.routes) {
        const earlier = rank[second.index];
        if (second === first || (earlier !== undefined && earlier < position)) {
          continue;
        }
        const cost =
          this.weight(first, second, search.traceOn) *
          crossingsBetween(geometryNow(first.index), geometryNow(second.index));
        const i = first.index;
        const j = second.index;
        delta += cost - (search.costs[i * size + j] ?? 0);
        updates.push([i, j, cost]);
      }
    });

    if (delta >= 0) {
      routes.splice(to, 1);
      routes.splice(from, 0, route);
      return false;
    }
    for (const r of changed) {
      const geometry = pending[r.index];
      if (geometry) {
        search.geometry[r.index] = geometry;
      }
    }
    for (const [i, j, cost] of updates) {
      search.costs[i * size + j] = cost;
      search.costs[j * size + i] = cost;
    }
    search.best += delta;
    return true;
  }
}

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

/** The x of every vertical run a horizontal run from p0 to p1 passes, clear of both corners, in order along it. */
function hopXs(
  p0: Point,
  p1: Point,
  dir: number,
  r0: number,
  r1: number,
  crossable: readonly (readonly Segment[])[],
): number[] {
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
function hopRuns(
  p0: Point,
  p1: Point,
  dir: number,
  r0: number,
  r1: number,
  crossable: readonly (readonly Segment[])[],
): [number, number][] {
  const runs: [number, number][] = [];
  for (const x of hopXs(p0, p1, dir, r0, r1, crossable)) {
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
function hopArc(xa: number, xb: number, y: number, dir: number): string {
  const arc = HOP + Math.abs(xb - xa) / 2;
  return ` L${xa - dir * HOP},${y} A${arc},${Math.min(arc, HOP + 1.5)} 0 0 ${dir > 0 ? 1 : 0} ${xb + dir * HOP},${y}`;
}

/** The quadratic curve that rounds the corner at p1, ending r1 along the leg towards p2. */
function cornerCurve(p1: Point, p2: Point, r1: number): string {
  const length2 = distance(p1, p2) || 1;
  return ` Q${p1.x},${p1.y} ${p1.x + ((p2.x - p1.x) / length2) * r1},${p1.y + ((p2.y - p1.y) / length2) * r1}`;
}

/** The rounded path for one route, with a hop wherever a horizontal run crosses another route's vertical run. */
function drawPath(
  index: number,
  routes: readonly Route[],
  resolved: readonly Point[][],
  verticals: readonly (readonly Segment[])[],
  traceOn: boolean,
): { d: string; hops: number } {
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
      const runs = hopRuns(p0, p1, dir, r0, r1, crossable);
      hops += runs.length;
      for (const [xa, xb] of runs) {
        d += hopArc(xa, xb, p0.y, dir);
      }
    }
    d += ` L${p1.x - ux * r1},${p1.y - uy * r1}`;
    if (r1) {
      d += cornerCurve(p1, points[i + 1] ?? p1, r1);
    }
  }
  return { d, hops };
}

function labelPoint(points: readonly Point[]): Point {
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

/** The vertical extent of one row's cards. An empty row has no extent. */
function rowExtent(members: readonly RouteBox[]): {
  top: number;
  bottom: number;
} {
  if (members.length === 0) {
    return { top: 0, bottom: 0 };
  }
  return {
    top: Math.min(...members.map((box) => box.y)),
    bottom: Math.max(...members.map((box) => box.y + box.height)),
  };
}

/** The span a gutter between row `index` and the row below it may use, clear of the cards on either side. */
function gutterBounds(
  rowBounds: readonly { top: number; bottom: number }[],
  index: number,
): [number, number] {
  const upper = rowBounds[index];
  const lower = rowBounds[index + 1];
  if (upper && lower) {
    return [upper.bottom + 18, lower.top - 20];
  }
  if (upper) {
    return [upper.bottom + 18, upper.bottom + 58];
  }
  if (lower) {
    return [lower.top - 58, lower.top - 20];
  }
  return [0, 40];
}

/**
 * The channels that one run's edges are laid into, and the ports, lanes and gutters they leave through.
 * Channels are created in call order, and the optimiser walks them in that order.
 */
class GutterPlan {
  readonly channels = new Channels();
  private readonly input: RouteInput;
  private readonly ids: string[];
  private readonly rowCount: number;
  private readonly rowBounds: { top: number; bottom: number }[];
  private readonly focus: string;
  private readonly focusCentre: number;
  private readonly focusRow: number;
  private readonly corridor: string;
  private readonly outerLeft: string;
  private readonly outerRight: string;

  constructor(input: RouteInput) {
    this.input = input;
    this.ids = [...input.boxes.keys()];
    this.rowCount = Math.max(0, ...input.rowOf.values()) + 1;
    this.rowBounds = Array.from({ length: this.rowCount }, (_, index) =>
      rowExtent(
        this.ids
          .filter((id) => this.rowIndex(id) === index)
          .map((id) => this.boxOf(id)),
      ),
    );
    this.focus = input.focus;
    const focusBox = this.boxOf(input.focus);
    this.focusCentre = focusBox.x + focusBox.width / 2;
    this.focusRow = this.rowIndex(input.focus);
    const { layeredBounds } = input;
    this.corridor = this.channels.channel(
      "corridor",
      this.focusCentre - CORRIDOR / 2 + 8,
      this.focusCentre + CORRIDOR / 2 - 8,
    );
    this.outerLeft = this.channels.channel(
      "outerL",
      layeredBounds.left - BAND_PAD - GUTTER + 6,
      layeredBounds.left - BAND_PAD - 6,
    );
    this.outerRight = this.channels.channel(
      "outerR",
      layeredBounds.right + BAND_PAD + 6,
      layeredBounds.right + BAND_PAD + GUTTER - 6,
    );
  }

  private boxOf(id: string): RouteBox {
    return this.input.boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  private rowIndex(id: string): number {
    return this.input.rowOf.get(id) ?? 0;
  }

  // Gutter i runs between row i and row i + 1, clear of the bubbles that stick out of the cards.
  private gutter(index: number): string {
    const [lo, hi] = gutterBounds(this.rowBounds, index);
    return this.channels.channel(`h${index}`, lo, hi);
  }

  // A card's bubble channel is the bubble's width, centred on the card, so table edges meet the bubble.
  // The start node's bubbles share the corridor.
  private port(id: string, side: "t" | "b"): { name: string; y: number } {
    const box = this.boxOf(id);
    const y = side === "t" ? box.y : box.y + box.height;
    if (id === this.focus) {
      return { name: this.corridor, y };
    }
    const centre = box.x + box.width / 2;
    const half = cardGeometry.bubbleWidth / 2;
    const name = this.channels.channel(
      `p${id}${side}`,
      centre - half,
      centre + half,
    );
    return { name, y };
  }

  private lane(id: string, side: "l" | "r"): string {
    const box = this.boxOf(id);
    if (side === "r") {
      return this.channels.channel(
        `l${id}r`,
        box.x + box.width + 16,
        box.x + box.width + CARD_GAP - 6,
      );
    }
    return this.channels.channel(`l${id}l`, box.x - CARD_GAP + 6, box.x - 16);
  }

  // The vertical channel for a span: the corridor when no card between the two rows sits over it; else the clear
  // gap between those cards nearest `targetX`; else the outer channel on `targetX`'s side. A span past the start
  // node's row always takes the outer channel.
  private spine(first: number, second: number, targetX: number): string {
    const outer = targetX < this.focusCentre ? this.outerLeft : this.outerRight;
    const lo = Math.min(first, second);
    const hi = Math.max(first, second);
    if (this.focusRow > lo && this.focusRow < hi) {
      return outer;
    }
    if (this.clearIn(this.corridor, lo, hi, 0)) {
      return this.corridor;
    }
    return this.gapChannel(lo, hi, targetX) ?? outer;
  }

  /**
   * A channel through the widest-enough clear x range between the cards of rows strictly between `first` and
   * `second`, within the layered cards' extent, choosing the one nearest `targetX`. `undefined` when there is none.
   */
  private gapChannel(
    first: number,
    second: number,
    targetX: number,
  ): string | undefined {
    const margin = 16;
    const blocked = this.ids
      .filter((id) => this.rowIndex(id) > first && this.rowIndex(id) < second)
      .map((id) => this.boxOf(id))
      .map((box) => [box.x - margin, box.x + box.width + margin] as const)
      .sort(([a], [b]) => a - b);
    const { left, right } = this.input.layeredBounds;
    const gaps: [number, number][] = [];
    let from = left;
    for (const [start, end] of blocked) {
      if (start > from) {
        gaps.push([from, start]);
      }
      from = Math.max(from, end);
    }
    if (right > from) {
      gaps.push([from, right]);
    }
    const nearest = gaps
      .filter(([a, b]) => b - a >= 12)
      .sort(
        ([a1, b1], [a2, b2]) =>
          Math.abs((a1 + b1) / 2 - targetX) - Math.abs((a2 + b2) / 2 - targetX),
      )[0];
    if (!nearest) {
      return undefined;
    }
    const [a, b] = nearest;
    return this.channels.channel(`gap${first}-${second}:${a}`, a, b);
  }

  private relationshipPort(
    id: string,
    side: "t" | "b",
  ): { name: string; y: number } {
    const box = this.boxOf(id);
    const y = side === "t" ? box.y : box.y + box.height;
    const name = this.channels.channel(
      `q${id}${side}`,
      box.x + RELATIONSHIP_LEFT,
      box.x + Math.min(RELATIONSHIP_WIDTH, box.width * 0.3),
    );
    return { name, y };
  }

  // A span is clear in a channel when no card outside its rows comes within `margin` of the channel's x range.
  private clearIn(
    name: string,
    first: number,
    second: number,
    margin = 10,
  ): boolean {
    const { lo, hi } = this.channels.bounds(name);
    return this.ids.every((id) => {
      const box = this.boxOf(id);
      const outside = this.rowIndex(id) <= first || this.rowIndex(id) >= second;
      return outside || box.x + box.width + margin < lo || box.x - margin > hi;
    });
  }

  // Table edges: a one-generation step that clears the cards drops straight; a longer span takes the spine.
  addTableRoute(edge: TableRoute): void {
    const { boxes, generation } = this.input;
    const first = this.rowIndex(edge.parent);
    const second = this.rowIndex(edge.child);
    // Edges point down the rows, and sub-rows never merge across an edge, so a parent is always above its child.
    if (first >= second || !boxes.has(edge.parent) || !boxes.has(edge.child)) {
      return;
    }
    const start = this.port(edge.parent, "b");
    const end = this.port(edge.child, "t");
    const g1 = this.gutter(first);
    const g2 = this.gutter(second - 1);
    const direct =
      second - first > 1 &&
      Math.abs(
        (generation.get(edge.child) ?? 0) - (generation.get(edge.parent) ?? 0),
      ) === 1;
    let stops: Stop[];
    const child = this.boxOf(edge.child);
    const childCentre = child.x + child.width / 2;
    if (direct && this.clearIn(end.name, first, second)) {
      stops = [
        [start.name, start.y],
        [start.name, g1],
        [end.name, g1],
        [end.name, end.y],
      ];
    } else if (direct && this.clearIn(start.name, first, second)) {
      stops = [
        [start.name, start.y],
        [start.name, g2],
        [end.name, g2],
        [end.name, end.y],
      ];
    } else {
      stops = [
        [start.name, start.y],
        [start.name, g1],
      ];
      if (second - first > 1) {
        const sp = this.spine(first, second, childCentre);
        stops.push([sp, g1], [sp, g2]);
      }
      stops.push([end.name, g2], [end.name, end.y]);
    }
    this.channels.add(
      { id: edge.id, kind: "table", other: childCentre },
      stops,
    );
  }

  // Declared relationships: from the upper card down to the lower one; cards in one row join through the gutter.
  addRelationshipRoute(relationship: RelationshipRoute): void {
    const { boxes } = this.input;
    if (!boxes.has(relationship.from) || !boxes.has(relationship.to)) {
      return;
    }
    const upperFirst =
      this.rowIndex(relationship.from) <= this.rowIndex(relationship.to);
    const upper = upperFirst ? relationship.from : relationship.to;
    const lower = upperFirst ? relationship.to : relationship.from;
    const iu = this.rowIndex(upper);
    const il = this.rowIndex(lower);
    const stops =
      iu === il
        ? this.sameRowStops(upper, lower, iu)
        : this.spanStops(upper, lower, iu, il);
    this.channels.add(
      {
        id: relationship.id,
        kind: "rel",
        other: this.boxOf(lower).x,
        startsAt: upper,
      },
      stops,
    );
  }

  private sameRowStops(upper: string, lower: string, iu: number): Stop[] {
    const below = iu < this.rowCount - 1;
    const side = below ? "b" : "t";
    const g = below ? this.gutter(iu) : this.gutter(iu - 1);
    const pa = this.relationshipPort(upper, side);
    const pb = this.relationshipPort(lower, side);
    return [
      [pa.name, pa.y],
      [pa.name, g],
      [pb.name, g],
      [pb.name, pb.y],
    ];
  }

  private spanStops(
    upper: string,
    lower: string,
    iu: number,
    il: number,
  ): Stop[] {
    const ps = this.relationshipPort(upper, "b");
    const pe = this.relationshipPort(lower, "t");
    const g1 = this.gutter(iu);
    const g2 = this.gutter(il - 1);
    if (il - iu === 1 || this.clearIn(pe.name, iu, il)) {
      return [
        [ps.name, ps.y],
        [ps.name, g1],
        [pe.name, g1],
        [pe.name, pe.y],
      ];
    }
    if (this.clearIn(ps.name, iu, il)) {
      return [
        [ps.name, ps.y],
        [ps.name, g2],
        [pe.name, g2],
        [pe.name, pe.y],
      ];
    }
    const sp = this.spine(iu, il, this.boxOf(lower).x);
    return [
      [ps.name, ps.y],
      [ps.name, g1],
      [sp, g1],
      [sp, g2],
      [pe.name, g2],
      [pe.name, pe.y],
    ];
  }

  // Column edges leave the source card on the right, run down a side lane, and enter the target on the left.
  addColumnRoute(column: ColumnRoute): void {
    const { boxes } = this.input;
    const from = this.boxOf(column.from);
    const to = this.boxOf(column.to);
    const ia = this.rowIndex(column.from);
    const ib = this.rowIndex(column.to);
    if (ia > ib || !boxes.has(column.from) || !boxes.has(column.to)) {
      return;
    }
    const s = { x: from.x + from.width, y: column.fromY };
    const e = { x: to.x, y: column.toY };
    const lr = this.lane(column.from, "r");
    const ll = this.lane(column.to, "l");
    const stops: Stop[] = [[s.x, s.y]];
    if (ia === ib) {
      const g = this.gutter(ia);
      stops.push([lr, s.y], [lr, g], [ll, g], [ll, e.y]);
    } else {
      const g1 = this.gutter(ia);
      const g2 = this.gutter(ib - 1);
      stops.push([lr, s.y], [lr, g1]);
      if (ib - ia > 1) {
        const sp = this.spine(ia, ib, e.x);
        stops.push([sp, g1], [sp, g2]);
      }
      stops.push([ll, g2], [ll, e.y]);
    }
    stops.push([e.x, e.y]);
    this.channels.add({ id: column.id, kind: "col", other: e.x }, stops);
  }
}

/** Routes every edge in one run: channels first, then the greedy order, then the rounded paths with hops. */
export function routeGutters(input: RouteInput): RouteResult {
  const { traceOn } = input;
  const plan = new GutterPlan(input);
  for (const edge of input.tableRoutes) {
    plan.addTableRoute(edge);
  }
  for (const relationship of input.relationshipRoutes) {
    plan.addRelationshipRoute(relationship);
  }
  for (const column of input.columnRoutes) {
    plan.addColumnRoute(column);
  }

  const { channels } = plan;
  channels.optimise(traceOn);
  const crossings = channels.crossings(traceOn);

  const { routes } = channels;
  const resolved = routes.map((route) => channels.resolve(route));
  const verticals = resolved.map((points) =>
    segmentsOf(points).filter(([p, q]) => p.x === q.x),
  );
  const paths = new Map<string, RoutedPath>();
  let hops = 0;
  routes.forEach((route, index) => {
    const drawn = drawPath(index, routes, resolved, verticals, traceOn);
    hops += drawn.hops;
    // Every route has at least two stops, so its first and last points are both set.
    const points = resolved[index] ?? [];
    paths.set(route.id, {
      d: drawn.d,
      labelAt: labelPoint(points),
      start: points[0] ?? { x: 0, y: 0 },
      end: points[points.length - 1] ?? { x: 0, y: 0 },
      startsAt: route.startsAt,
    });
  });
  return { paths, crossings, hops };
}
