import type { OrderResult } from "../order/index.js";
import { boxRects } from "../place/boxRects.js";
import type { LayoutGraph, LayoutOptions, Point, Rect } from "../types.js";
import { routeChannel } from "./channel.js";
import type { ChannelPiece } from "./channelTypes.js";
import { membersOf, type Phases, type Run } from "./pieces.js";
import { framePoint, type Geometry, polylinesOf } from "./polylines.js";
import { stubCrossings } from "./stubs.js";

type Effort = NonNullable<LayoutOptions["effort"]>;

/** Spacing used when `LayoutOptions.spacing` leaves a field out; the same defaults as placement. */
const DEFAULT_SPACING = { rank: 28, edge: 4 };

/** Overlapping pairs of hyperedges examined in one routing, by effort. Past it, tracks keep left-edge order only. */
const PAIR_BUDGET: Record<Effort, number> = {
  fast: 100_000,
  balanced: 1_000_000,
  thorough: 4_000_000,
};

/** Piece pairs a band's doglegs may test, by effort. */
const DOGLEG_WORK: Record<Effort, number> = {
  fast: 20_000,
  balanced: 200_000,
  thorough: 1_000_000,
};

export interface RouteWork {
  /** Overlapping pairs of hyperedges examined, over every band. */
  pairs: number;
  /** Tracks used, over every band. */
  tracks: number;
  /** Crossings among the polylines: those the bands count, and those lateral stubs make within their block. */
  crossings: number;
  /** The pair budget ran out, so `crossings` is a lower bound. */
  capped: boolean;
}

export interface Routing {
  /** Centre of each real node once the bands are widened. */
  nodes: ReadonlyMap<string, Point>;
  /**
   * Orthogonal polyline of each routed edge, from its source end to its target end. Edges of kinds that are not routed,
   * and self-loops (which layering leaves out of the bands), have no entry: self-loops are not drawn yet.
   */
  edges: ReadonlyMap<string, Point[]>;
  /** The rectangle of each cluster box, recomputed for the re-stacked ranks. Empty when there are no clusters. */
  clusters: ReadonlyMap<string, Rect>;
  work: RouteWork;
}

/**
 * Routes every routed edge through the bands between ranks. Each band gets the tracks its runs need, and its width
 * becomes `(tracks + 1) * edge`, at least `spacing.rank`; the ranks are then re-stacked across the drawing with those
 * widths, the in-rank coordinates placement chose are kept, and an anchor is moved back to the origin.
 */
export function route(
  graph: LayoutGraph,
  options: LayoutOptions,
  phases: Phases,
): Routing {
  const { ordering, placement } = phases;
  const spacing = { ...DEFAULT_SPACING, ...options.spacing };
  const effort: Effort = options.effort ?? "balanced";
  const down = options.direction === "down";
  const { layered } = ordering;
  const members = membersOf(graph, options, phases);
  const bands: Run[][] = Array.from({ length: layered.ranks }, () => []);
  for (const member of members) {
    for (const run of member.runs) {
      bands[run.rank]?.push(run);
    }
  }
  const { widths, work } = routeBands(bands, {
    edge: spacing.edge,
    rank: spacing.rank,
    budget: PAIR_BUDGET[effort],
    doglegWork: DOGLEG_WORK[effort],
  });

  const nodeHalves = layered.nodes.map((node, i) => {
    const real = node.id === undefined ? undefined : graph.nodes[i];
    return real === undefined ? 0 : (down ? real.height : real.width) / 2;
  });
  const halves = Array.from({ length: layered.ranks }, (_, r) =>
    layered.nodes.reduce(
      (most, node, i) =>
        node.rank === r ? Math.max(most, nodeHalves[i] ?? 0) : most,
      0,
    ),
  );
  // Each rank gap also holds the margins of the boxes it separates, as placement's does.
  const gaps = widths.map((w, r) =>
    Math.max(w, placement.boxes.plan.rankGap[r] ?? 0),
  );
  const centres = stackRanks(halves, gaps, anchorRank(ordering, options));
  const geometry: Geometry = {
    down,
    edge: spacing.edge,
    centres,
    halves,
    nodeHalves,
    portAcross: layered.nodes.map((node) =>
      node.port === undefined
        ? undefined
        : node.port.offset - (nodeHalves[node.port.owner] ?? 0),
    ),
    ranks: layered.nodes.map((node) => node.rank),
  };

  const nodes = new Map<string, Point>();
  const inRank = layered.nodes.map((_, i) => {
    const point = placement.points[i];
    return point === undefined ? 0 : down ? point.x : point.y;
  });
  layered.nodes.forEach((node, i) => {
    if (node.id !== undefined && placement.points[i] !== undefined) {
      nodes.set(
        node.id,
        framePoint(down, inRank[i] ?? 0, centres[node.rank] ?? 0),
      );
    }
  });
  work.crossings += stubCrossings(layered, inRank, geometry.portAcross);
  const clusters = boxRects(placement.boxes, centres, halves);
  return {
    nodes,
    edges: polylinesOf(members, geometry),
    clusters,
    work,
  };
}

/**
 * Gives each band its tracks, writes each run's track back onto the run, and returns each band's width. The last
 * band, beneath the last rank, is as wide as its tracks need, or none when it has none.
 */
function routeBands(
  bands: readonly Run[][],
  options: { edge: number; rank: number; budget: number; doglegWork: number },
): { widths: number[]; work: RouteWork } {
  const work: RouteWork = { pairs: 0, tracks: 0, crossings: 0, capped: false };
  const widths = bands.map((runs, r) => {
    const pieces: ChannelPiece[] = runs.map((run) => ({
      from: run.from,
      to: run.to,
      flat: run.flat,
      trunk: run.trunk,
    }));
    const result = routeChannel(pieces, {
      edge: options.edge,
      budget: options.budget - work.pairs,
      doglegWork: options.doglegWork,
    });
    runs.forEach((run, i) => {
      run.track = result.track[i] ?? -1;
      run.jog = result.jogs[i];
    });
    work.pairs += result.pairs;
    work.tracks += result.trackCount;
    work.crossings += result.crossings;
    work.capped ||= result.capped;
    const last = r === bands.length - 1;
    if (result.trackCount === 0 && last) {
      return 0;
    }
    return Math.max(options.rank, (result.trackCount + 1) * options.edge);
  });
  return { widths, work };
}

/**
 * The across centre of each rank: the first rank's top is at the origin, and each rank starts `width` after the
 * bottom of the one above. An anchor's rank is then moved to the origin.
 */
function stackRanks(
  halves: readonly number[],
  widths: readonly number[],
  anchor: number | undefined,
): number[] {
  const centres: number[] = [];
  let top = 0;
  halves.forEach((half, r) => {
    centres.push(top + half);
    top += 2 * half + (widths[r] ?? 0);
  });
  const shift = anchor === undefined ? 0 : -(centres[anchor] ?? 0);
  return centres.map((c) => c + shift);
}

/** The rank of the anchor node, when the options name one. */
function anchorRank(
  ordering: OrderResult,
  options: LayoutOptions,
): number | undefined {
  if (options.anchor === undefined) {
    return undefined;
  }
  return ordering.layered.nodes.find((node) => node.id === options.anchor)
    ?.rank;
}
