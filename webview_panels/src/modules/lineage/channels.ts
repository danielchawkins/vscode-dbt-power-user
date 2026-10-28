import type { Point } from "./engine/layoutEngine";
import {
  type Geometry,
  crossingsBetween,
  EMPTY_GEOMETRY,
  geometryOf,
  sameSpot,
} from "./routeGeometry";

type Kind = "table" | "rel" | "col";
/** A coordinate: a number, or the name of a channel that assigns it per route. */
type Coord = number | string;
export type Stop = readonly [Coord, Coord];

export interface Route {
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

const isChannel = (coord: Coord): coord is string => typeof coord === "string";

/** The total of all pair costs, each pair counted once. */
const totalOf = (costs: readonly number[]): number =>
  costs.reduce((sum, cost) => sum + cost, 0) / 2;

/** A pair's new cost as [its index, its mirror index, cost], both in `costs`. */
type PairUpdate = [number, number, number];

/** A priced move: the change in the total cost, and the new cost of every pair it touches. */
interface Pricing {
  delta: number;
  updates: PairUpdate[];
}

/** The greedy search's mutable state: its best total, its evaluation count and the per-route tables. */
class SearchState {
  readonly traceOn: boolean;
  readonly geometry: Geometry[];
  /** Weighted crossings of each pair in tenths, at `i * routes + j`; symmetric. */
  readonly costs: number[];
  best: number;
  evaluations = 0;

  constructor(traceOn: boolean, geometry: Geometry[], costs: number[]) {
    this.traceOn = traceOn;
    this.geometry = geometry;
    this.costs = costs;
    this.best = totalOf(costs);
  }

  /** Counts one evaluation; returns false, counting nothing, once the budget is spent. */
  spend(): boolean {
    if (this.evaluations >= EVALUATION_BUDGET) {
      return false;
    }
    this.evaluations++;
    return true;
  }

  /** Keeps a priced move: stores the changed routes' geometry and pair costs, and moves the total by its delta. */
  commit(
    changed: readonly Route[],
    pending: readonly (Geometry | undefined)[],
    pricing: Pricing,
  ): void {
    for (const r of changed) {
      const geometry = pending[r.index];
      if (geometry) {
        this.geometry[r.index] = geometry;
      }
    }
    for (const [index, mirror, cost] of pricing.updates) {
      this.costs[index] = cost;
      this.costs[mirror] = cost;
    }
    this.best += pricing.delta;
  }
}

interface Move {
  routes: Route[];
  from: number;
  to: number;
  search: SearchState;
}

export class Channels {
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
    const costs = Array.from({ length: size * size }, () => 0);
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
    const search = new SearchState(traceOn, geometry, costs);
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
        if (i === j || !search.spend()) {
          continue;
        }
        if (this.tryMove({ routes, from: i, to: j, search })) {
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
  private tryMove({ routes, from, to, search }: Move): boolean {
    const changed = routes.slice(Math.min(from, to), Math.max(from, to) + 1);
    const [route] = routes.splice(from, 1);
    if (!route) {
      return false;
    }
    routes.splice(to, 0, route);
    const pending = this.pendingGeometry(changed);
    const pricing = this.priceMove(changed, pending, search);
    if (pricing.delta >= 0) {
      routes.splice(to, 1);
      routes.splice(from, 0, route);
      return false;
    }
    search.commit(changed, pending, pricing);
    return true;
  }

  /** The geometry of each changed route under the moved track order, by index. */
  private pendingGeometry(changed: readonly Route[]): (Geometry | undefined)[] {
    const pending: (Geometry | undefined)[] = [];
    for (const r of changed) {
      pending[r.index] = geometryOf(this.resolve(r));
    }
    return pending;
  }

  /** Prices a move: the pairs with a changed route, each once, against their costs in the search. */
  private priceMove(
    changed: readonly Route[],
    pending: readonly (Geometry | undefined)[],
    search: SearchState,
  ): Pricing {
    const size = this.routes.length;
    const geometryNow = (index: number): Geometry =>
      pending[index] ?? search.geometry[index] ?? EMPTY_GEOMETRY;

    // Each pair with a changed route is priced once; a pair of two changed routes is priced at the earlier one.
    const rank: (number | undefined)[] = [];
    changed.forEach((r, position) => {
      rank[r.index] = position;
    });
    const updates: PairUpdate[] = [];
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
        updates.push([i * size + j, j * size + i, cost]);
      }
    });
    return { delta, updates };
  }
}
