/**
 * Channel routing for the band between two adjacent ranks (or below the last rank, for flat edges). A piece is one
 * member edge's run through the band: it leaves its upper end, runs along a track and enters its lower end. Pieces
 * that leave or enter the same point form one hyperedge and share a track. Each overlapping pair of hyperedges gets an
 * above or below preference from the exact crossings each order would cost; preference cycles are broken greedily;
 * tracks are then assigned left edge first, below every overlapping hyperedge preferred above it.
 */

/** One member edge's run through a band, with in-rank coordinates at its ends. */
export interface ChannelPiece {
  /** In-rank coordinate of the upper end. */
  from: number;
  /** In-rank coordinate of the other end. */
  to: number;
  /**
   * Both ends sit on the upper edge of the band, as for a flat edge routed beneath its rank. Otherwise the lower end
   * sits on the band's lower edge.
   */
  flat: boolean;
}

export interface ChannelOptions {
  /** Space between two tracks, and between two runs that share a track. */
  edge: number;
  /** Most overlapping pairs of hyperedges to examine. Past it the rest keep their left-edge tracks and `capped` is set. */
  budget: number;
}

export interface ChannelRouting {
  /** Track of each piece, counted from the upper edge; -1 for a straight piece that needs none. */
  track: number[];
  /** Tracks used, so the band needs `(trackCount + 1) * edge` of width. */
  trackCount: number;
  /** Proper crossings between the pieces of different hyperedges, and of straight pieces with tracked runs. */
  crossings: number;
  /** Overlapping pairs of hyperedges examined: the work count. */
  pairs: number;
  /** Set when `budget` ran out, so `crossings` misses the pairs that were not examined. */
  capped: boolean;
}

/** Pieces that leave or enter one point, and the span of the track they need. */
interface Hyperedge {
  members: number[];
  lo: number;
  hi: number;
  track: number;
}

/** Routes the pieces of one band onto tracks, minimising the crossings the preferences can see. */
export function routeChannel(
  pieces: readonly ChannelPiece[],
  options: ChannelOptions,
): ChannelRouting {
  const all = hyperedgesOf(pieces);
  const straight = all.filter((h) => h.hi === h.lo);
  const tracked = all
    .filter((h) => h.hi > h.lo)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const { pairs, capped } = overlappingPairs(tracked, options.budget);
  const succ = preferences(pieces, tracked, pairs);
  assignTracks(tracked, succ, options.edge);

  let crossings = 0;
  for (const [i, j] of pairs) {
    const a = tracked[i];
    const b = tracked[j];
    if (a && b) {
      crossings +=
        a.track < b.track
          ? crossingsAbove(pieces, a, b)
          : crossingsAbove(pieces, b, a);
    }
  }
  for (const s of straight) {
    for (const h of tracked) {
      crossings += s.members.length * insideCount(pieces, h, s.lo);
    }
  }

  const track = pieces.map(() => -1);
  for (const h of [...straight, ...tracked]) {
    for (const m of h.members) {
      track[m] = h.track;
    }
  }
  return {
    track,
    trackCount: tracked.reduce((most, h) => Math.max(most, h.track + 1), 0),
    crossings,
    pairs: pairs.length,
    capped,
  };
}

/** Groups pieces that share an upper or a lower point, transitively, into hyperedges. */
function hyperedgesOf(pieces: readonly ChannelPiece[]): Hyperedge[] {
  const parent = pieces.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      r = parent[r] ?? r;
    }
    return r;
  };
  const join = (seen: Map<number, number>, x: number, i: number) => {
    const j = seen.get(x);
    if (j === undefined) {
      seen.set(x, i);
    } else {
      parent[root(i)] = root(j);
    }
  };
  const upper = new Map<number, number>();
  const lower = new Map<number, number>();
  pieces.forEach((p, i) => {
    join(upper, p.from, i);
    if (p.flat) {
      join(upper, p.to, i);
    } else {
      join(lower, p.to, i);
    }
  });
  const byRoot = new Map<number, Hyperedge>();
  pieces.forEach((p, i) => {
    const r = root(i);
    const h = byRoot.get(r) ?? {
      members: [],
      lo: Number.POSITIVE_INFINITY,
      hi: Number.NEGATIVE_INFINITY,
      track: -1,
    };
    h.members.push(i);
    h.lo = Math.min(h.lo, p.from, p.to);
    h.hi = Math.max(h.hi, p.from, p.to);
    byRoot.set(r, h);
  });
  return [...byRoot.values()];
}

/** The number of member runs of a hyperedge that pass strictly through `x`. */
function insideCount(
  pieces: readonly ChannelPiece[],
  h: Hyperedge,
  x: number,
): number {
  let count = 0;
  for (const m of h.members) {
    const p = pieces[m];
    if (p && Math.min(p.from, p.to) < x && x < Math.max(p.from, p.to)) {
      count++;
    }
  }
  return count;
}

/**
 * Crossings when `upper` runs above `lower`: the lower's upper ends that rise through the upper's runs, and the
 * upper's lower ends that fall through the lower's runs.
 */
function crossingsAbove(
  pieces: readonly ChannelPiece[],
  upper: Hyperedge,
  lower: Hyperedge,
): number {
  let count = 0;
  for (const m of lower.members) {
    const p = pieces[m];
    if (p) {
      count += insideCount(pieces, upper, p.from);
      count += p.flat ? insideCount(pieces, upper, p.to) : 0;
    }
  }
  for (const m of upper.members) {
    const p = pieces[m];
    if (p && !p.flat) {
      count += insideCount(pieces, lower, p.to);
    }
  }
  return count;
}

/**
 * Every pair of tracked hyperedges whose spans overlap, found by a sweep over their starts. Stops at the budget.
 * `hypers` is sorted by start, so each hyperedge is compared only with those that start before it ends.
 */
function overlappingPairs(
  hypers: readonly Hyperedge[],
  budget: number,
): { pairs: [number, number][]; capped: boolean } {
  const pairs: [number, number][] = [];
  let capped = false;
  for (let i = 0; i < hypers.length && !capped; i++) {
    const a = hypers[i];
    for (let j = i + 1; a && j < hypers.length && !capped; j++) {
      const b = hypers[j];
      if (!b || b.lo >= a.hi) {
        break;
      }
      if (pairs.length >= budget) {
        capped = true;
      } else {
        pairs.push([i, j]);
      }
    }
  }
  return { pairs, capped };
}

/**
 * The preference graph: an edge from i to j where i should run above j. A pair with equal costs either way has no
 * preference. Cycles are broken where they occur: the node with fewest unmet predecessors goes next.
 */
function preferences(
  pieces: readonly ChannelPiece[],
  tracked: readonly Hyperedge[],
  pairs: readonly [number, number][],
): number[][] {
  const succ: number[][] = tracked.map(() => []);
  for (const [i, j] of pairs) {
    const a = tracked[i];
    const b = tracked[j];
    if (!a || !b) {
      continue;
    }
    const ij = crossingsAbove(pieces, a, b);
    const ji = crossingsAbove(pieces, b, a);
    if (ij < ji) {
      succ[i]?.push(j);
    } else if (ji < ij) {
      succ[j]?.push(i);
    }
  }
  return succ;
}

/** Nodes in an order that respects every preference that is not part of a cycle; ties go to the lower index. */
function preferredOrder(succ: readonly (readonly number[])[]): number[] {
  const count = succ.length;
  const unmet = new Array<number>(count).fill(0);
  for (const list of succ) {
    for (const j of list) {
      unmet[j] = (unmet[j] ?? 0) + 1;
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < count; i++) {
    if (unmet[i] === 0) {
      queue.push(i);
    }
  }
  const done = new Array<boolean>(count).fill(false);
  const order: number[] = [];
  for (let head = 0; order.length < count; head++) {
    if (head >= queue.length) {
      queue.push(fewestUnmet(unmet, done));
    }
    const v = queue[head] ?? -1;
    if (done[v]) {
      continue;
    }
    done[v] = true;
    order.push(v);
    for (const j of succ[v] ?? []) {
      unmet[j] = (unmet[j] ?? 0) - 1;
      if (!done[j] && unmet[j] === 0) {
        queue.push(j);
      }
    }
  }
  return order;
}

/** The undone node with fewest unmet predecessors, the lowest index on a tie: where a preference cycle is cut. */
function fewestUnmet(unmet: readonly number[], done: readonly boolean[]): number {
  let best = -1;
  unmet.forEach((u, i) => {
    if (!done[i] && (best < 0 || u < (unmet[best] ?? 0))) {
      best = i;
    }
  });
  return best;
}

/**
 * Left-edge assignment in preference order: each hyperedge takes the lowest track that is below every overlapping
 * hyperedge preferred above it and clears every hyperedge already on that track by `edge`.
 */
function assignTracks(
  tracked: Hyperedge[],
  succ: readonly (readonly number[])[],
  edge: number,
): void {
  const preds: number[][] = tracked.map(() => []);
  succ.forEach((list, i) => {
    for (const j of list) {
      preds[j]?.push(i);
    }
  });
  const occupants: Hyperedge[][] = [];
  for (const v of preferredOrder(succ)) {
    const h = tracked[v];
    if (!h) {
      continue;
    }
    let t = 0;
    for (const p of preds[v] ?? []) {
      const above = tracked[p]?.track ?? -1;
      if (above >= 0) {
        t = Math.max(t, above + 1);
      }
    }
    while (occupants[t]?.some((o) => tooClose(o, h, edge))) {
      t++;
    }
    (occupants[t] ??= []).push(h);
    h.track = t;
  }
}

/** Whether two hyperedges on one track come closer than `edge`, end to end. */
function tooClose(a: Hyperedge, b: Hyperedge, edge: number): boolean {
  return a.lo < b.hi + edge && b.lo < a.hi + edge;
}
