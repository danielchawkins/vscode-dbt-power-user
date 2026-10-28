// Spike, not production code: a one-file prototype of the planned graph-layout pipeline, written to time and measure
// network-simplex ranking, sweep ordering with transpose, quadratic placement by gradient projection, and
// constraint-ordered channel routing on synthetic graphs. See README.md beside it for how to run it and what it showed.
// The production package splits each phase into its own module behind the API in packages/graph-layout/src/types.ts.

export interface SPort {
  id: string;
  /** Flow sides in the canonical frame: `in` faces the previous rank, `out` the next. */
  side: "in" | "out";
  /** Distance from the node's leading edge along the in-rank axis. */
  offset: number;
}
export interface SNode {
  id: string;
  /** Extent along the in-rank axis (height when ranks run left to right). */
  breadth: number;
  /** Extent along the rank axis (width when ranks run left to right). */
  depth: number;
  partition?: number;
  ports?: SPort[];
}
export type Kind = "dep" | "col" | "rel";
export interface SEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  kind: Kind;
}
export interface Hints {
  rank: Map<string, number>;
  pos: Map<string, number>;
}
export interface Options {
  anchor?: string;
  hints?: Hints;
  /** Weight of the hint terms; 0 ignores hints except as the initial order. */
  stability: number;
  sweeps: number;
  partitions: boolean;
  nodeGap: number;
  edgeGap: number;
  minChannel: number;
}

const SCALED = process.env.GP_SCALED !== "0";
const GP_MAX = Number(process.env.GP_MAX ?? 500);
const KIND: Record<Kind, { ranks: boolean; weight: number }> = {
  dep: { ranks: true, weight: 1 },
  col: { ranks: false, weight: 0.5 },
  rel: { ranks: false, weight: 0.3 },
};

export interface Result {
  rank: Map<string, number>;
  /** Centre of each node, canonical frame: l along the rank axis, p along the in-rank axis. */
  centre: Map<string, { l: number; p: number }>;
  paths: Map<string, { l: number; p: number }[]>;
  stats: {
    ranks: number;
    dummies: number;
    nsIterations: number;
    gpIterations: number;
    crossings: number;
    bends: number;
    length: number;
    area: number;
    compactness: number;
    overlaps: number;
    tracks: number;
    objective: number;
  };
  ms: { rank: number; order: number; place: number; route: number; total: number };
  hints: Hints;
}

// ---------------------------------------------------------------- ranking: network simplex (Gansner et al. 1993)

interface REdge {
  u: number;
  v: number;
  minlen: number;
  weight: number;
}

/** Ranks `n` nodes so every edge has rank(v) - rank(u) >= minlen, minimising the weighted sum of edge lengths. */
export function networkSimplex(n: number, input: REdge[], maxIter = 10_000): { rank: Int32Array; iterations: number } {
  // Merge parallel edges: summed weight, largest minlen.
  const merged = new Map<number, REdge>();
  for (const e of input) {
    const key = e.u * n + e.v;
    const seen = merged.get(key);
    if (seen) {
      seen.weight += e.weight;
      seen.minlen = Math.max(seen.minlen, e.minlen);
    } else {
      merged.set(key, { ...e });
    }
  }
  const edges = [...merged.values()];
  const inc: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    inc[e.u]!.push(i);
    inc[e.v]!.push(i);
  });
  // Initial ranks: longest path from the sources, in topological order.
  const rank = new Int32Array(n);
  const indeg = new Int32Array(n);
  for (const e of edges) indeg[e.v]!++;
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q]!;
    for (const ei of inc[u]!) {
      const e = edges[ei]!;
      if (e.u !== u) continue;
      rank[e.v] = Math.max(rank[e.v]!, rank[u]! + e.minlen);
      if (--indeg[e.v]! === 0) queue.push(e.v);
    }
  }
  if (queue.length !== n) throw new Error("ranking graph has a cycle");
  // Pull every source down to just above its nearest child, so the tight tree grows faster.
  const slack = (e: REdge) => rank[e.v]! - rank[e.u]! - e.minlen;

  // Feasible tight spanning tree. The graph is connected (the caller adds a root).
  const inTree = new Uint8Array(n);
  const treeEdge = new Uint8Array(edges.length);
  let treeSize = 0;
  const grow = (start: number) => {
    const stack = [start];
    if (!inTree[start]) {
      inTree[start] = 1;
      treeSize++;
    }
    while (stack.length) {
      const x = stack.pop()!;
      for (const ei of inc[x]!) {
        const e = edges[ei]!;
        const y = e.u === x ? e.v : e.u;
        if (!inTree[y] && slack(e) === 0) {
          inTree[y] = 1;
          treeSize++;
          treeEdge[ei] = 1;
          stack.push(y);
        }
      }
    }
  };
  grow(0);
  while (treeSize < n) {
    let best = -1;
    let bestSlack = Infinity;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (inTree[e.u] !== inTree[e.v]) {
        const s = slack(e);
        if (s < bestSlack) {
          bestSlack = s;
          best = i;
        }
      }
    }
    if (best < 0) throw new Error("ranking graph is not connected");
    const e = edges[best]!;
    const delta = inTree[e.u] ? bestSlack : -bestSlack;
    for (let i = 0; i < n; i++) if (inTree[i]) rank[i]! += delta;
    const tree = [];
    for (let i = 0; i < n; i++) if (inTree[i]) tree.push(i);
    for (const t of tree) grow(t);
  }

  // Low/lim numbering, parents and cut values over the rooted tree (dagre's formulation).
  const parent = new Int32Array(n);
  const parentEdge = new Int32Array(n);
  const low = new Int32Array(n);
  const lim = new Int32Array(n);
  const cut = new Float64Array(edges.length);
  const order: number[] = [];
  const index = () => {
    order.length = 0;
    parent.fill(-1);
    parentEdge.fill(-1);
    let next = 1;
    const visit = (root: number) => {
      // Iterative postorder.
      const stack: [number, number][] = [[root, 0]];
      low[root] = next;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        const [x, k] = top;
        const list = inc[x]!;
        if (k < list.length) {
          top[1]++;
          const ei = list[k]!;
          if (!treeEdge[ei] || ei === parentEdge[x]) continue;
          const e = edges[ei]!;
          const y = e.u === x ? e.v : e.u;
          parent[y] = x;
          parentEdge[y] = ei;
          low[y] = next;
          stack.push([y, 0]);
        } else {
          lim[x] = next++;
          order.push(x);
          stack.pop();
        }
      }
    };
    visit(0);
  };
  const cutValues = () => {
    for (const child of order) {
      const pe = parentEdge[child]!;
      if (pe < 0) continue;
      const p = parent[child]!;
      const ge = edges[pe]!;
      const childIsTail = ge.u === child;
      let value = ge.weight;
      for (const ei of inc[child]!) {
        if (ei === pe) continue;
        const e = edges[ei]!;
        const isOut = e.u === child;
        const other = isOut ? e.v : e.u;
        if (other === p) continue;
        const pointsToHead = isOut === childIsTail;
        value += pointsToHead ? e.weight : -e.weight;
        if (treeEdge[ei] && parent[other] === child) {
          value += pointsToHead ? -cut[ei]! : cut[ei]!;
        }
      }
      cut[pe] = value;
    }
  };
  const descendant = (x: number, root: number) => low[root]! <= lim[x]! && lim[x]! <= lim[root]!;
  index();
  cutValues();
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    let leave = -1;
    for (let i = 0; i < edges.length; i++) {
      if (treeEdge[i] && cut[i]! < 0) {
        leave = i;
        break;
      }
    }
    if (leave < 0) break;
    const le = edges[leave]!;
    // The tail side of the tree edge, as dagre's enterEdge.
    let tailRoot = parent[le.v] === le.u ? le.v : le.u;
    let flip = false;
    if (lim[le.u]! > lim[le.v]!) {
      tailRoot = le.v;
      flip = true;
    } else {
      tailRoot = le.u;
    }
    let enter = -1;
    let enterSlack = Infinity;
    for (let i = 0; i < edges.length; i++) {
      if (treeEdge[i]) continue;
      const e = edges[i]!;
      if (flip === descendant(e.u, tailRoot) && flip !== descendant(e.v, tailRoot)) {
        const s = slack(e);
        if (s < enterSlack) {
          enterSlack = s;
          enter = i;
        }
      }
    }
    if (enter < 0) break;
    treeEdge[leave] = 0;
    treeEdge[enter] = 1;
    index();
    cutValues();
    // Re-rank from the root along tree edges.
    for (let k = order.length - 1; k >= 0; k--) {
      const x = order[k]!;
      const pe = parentEdge[x]!;
      if (pe < 0) continue;
      const e = edges[pe]!;
      rank[x] = e.u === x ? rank[parent[x]!]! - e.minlen : rank[parent[x]!]! + e.minlen;
    }
  }
  return { rank, iterations };
}

// ---------------------------------------------------------------- the layered graph

interface LNode {
  /** Index into the input nodes, or -1 for a dummy. */
  real: number;
  rank: number;
  breadth: number;
  /** Order key while ordering, position along the in-rank axis after placement. */
  pos: number;
}
interface Seg {
  /** Bundle id: every input edge of one kind between one pair of nodes. */
  bundle: number;
  top: number;
  bottom: number;
  weight: number;
  /** Port offsets from each end node's centre, averaged over the bundle. */
  oTop: number;
  oBottom: number;
}
interface Bundle {
  edges: number[];
  chain: number[];
  reversed: boolean;
  /** Same-rank bundle: routed in the channel after its rank. */
  flat: boolean;
}

/** A seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layout(nodes: SNode[], edges: SEdge[], options: Options): Result {
  const t0 = performance.now();
  const idx = new Map(nodes.map((node, i) => [node.id, i] as const));
  const n = nodes.length;
  const portOf = (node: SNode, port: string | undefined): number => {
    const found = port ? node.ports?.find((p) => p.id === port) : undefined;
    return (found ? found.offset : node.breadth / 2) - node.breadth / 2;
  };

  // ---- ranking: dependency edges only, plus partition gates, hint anchors and a root joining components.
  const rEdges: REdge[] = [];
  let extra = n;
  const depPairs = edges.filter((e) => KIND[e.kind].ranks && e.source !== e.target);
  // Cycle removal: DFS back edges are reversed (the plan uses Eades-Lin-Smyth instead).
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const e of depPairs) out[idx.get(e.source)!]!.push(idx.get(e.target)!);
  const state = new Uint8Array(n);
  const back = new Set<number>();
  for (let s = 0; s < n; s++) {
    if (state[s]) continue;
    const stack: [number, number][] = [[s, 0]];
    state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const list = out[top[0]]!;
      if (top[1] < list.length) {
        const y = list[top[1]++]!;
        if (state[y] === 1) back.add(top[0] * n + y);
        else if (state[y] === 0) {
          state[y] = 1;
          stack.push([y, 0]);
        }
      } else {
        state[top[0]] = 2;
        stack.pop();
      }
    }
  }
  for (const e of depPairs) {
    const u = idx.get(e.source)!;
    const v = idx.get(e.target)!;
    if (back.has(u * n + v)) rEdges.push({ u: v, v: u, minlen: 1, weight: 1 });
    else rEdges.push({ u, v, minlen: 1, weight: 1 });
  }
  if (options.partitions) {
    const parts = [...new Set(nodes.map((node) => node.partition ?? 0))].sort((a, b) => a - b);
    const gate = new Map<number, number>();
    for (const p of parts.slice(0, -1)) gate.set(p, extra++);
    parts.forEach((p, k) => {
      const next = parts[k + 1];
      const g = gate.get(p);
      if (g !== undefined && next !== undefined) {
        const ng = gate.get(next);
        if (ng !== undefined) rEdges.push({ u: g, v: ng, minlen: 1, weight: 0 });
      }
    });
    nodes.forEach((node, i) => {
      const p = node.partition ?? 0;
      const k = parts.indexOf(p);
      const g = gate.get(p);
      if (g !== undefined) rEdges.push({ u: i, v: g, minlen: 0, weight: 0 });
      const prev = parts[k - 1];
      const pg = prev === undefined ? undefined : gate.get(prev);
      if (pg !== undefined) rEdges.push({ u: pg, v: i, minlen: 1, weight: 0 });
    });
  }
  const hints = options.hints;
  if (hints && options.stability > 0 && hints.rank.size > 0) {
    // |rank(v) - hint(v)| through a rigid chain of reference nodes and one mediator per hinted node.
    const hinted = nodes.map((node, i) => [i, hints.rank.get(node.id)] as const).filter(([, r]) => r !== undefined);
    const lo = Math.min(...hinted.map(([, r]) => r!));
    const hi = Math.max(...hinted.map(([, r]) => r!));
    const chain: number[] = [];
    for (let r = lo; r <= hi; r++) {
      chain.push(extra++);
      if (chain.length > 1) rEdges.push({ u: chain.at(-2)!, v: chain.at(-1)!, minlen: 1, weight: 1000 });
    }
    for (const [i, r] of hinted) {
      const m = extra++;
      rEdges.push({ u: m, v: i, minlen: 0, weight: options.stability });
      rEdges.push({ u: m, v: chain[r! - lo]!, minlen: 0, weight: options.stability });
    }
  }
  const root = extra++;
  for (let i = 0; i < extra - 1; i++) rEdges.push({ u: root, v: i, minlen: 0, weight: 0 });
  // The root edges keep the graph connected; network simplex needs a spanning tree.
  const ns = networkSimplex(extra, rEdges);
  const minRank = Math.min(...Array.from(ns.rank.subarray(0, n)));
  const rankOf = Array.from(ns.rank.subarray(0, n), (r) => r - minRank);
  const tRank = performance.now();

  // ---- layered graph: one bundle per kind and node pair, with a dummy chain across each rank it spans.
  const lnodes: LNode[] = nodes.map((node, i) => ({ real: i, rank: rankOf[i]!, breadth: node.breadth, pos: 0 }));
  const bundleKey = new Map<string, number>();
  const bundles: Bundle[] = [];
  edges.forEach((e, ei) => {
    if (e.source === e.target) return;
    const key = `${e.kind}|${e.source}|${e.target}`;
    let b = bundleKey.get(key);
    if (b === undefined) {
      b = bundles.length;
      bundleKey.set(key, b);
      bundles.push({ edges: [], chain: [], reversed: false, flat: false });
    }
    bundles[b]!.edges.push(ei);
  });
  const segs: Seg[] = [];
  bundles.forEach((bundle, b) => {
    const e0 = edges[bundle.edges[0]!]!;
    let u = idx.get(e0.source)!;
    let v = idx.get(e0.target)!;
    if (rankOf[u]! > rankOf[v]!) {
      [u, v] = [v, u];
      bundle.reversed = true;
    }
    const w = KIND[e0.kind].weight * Math.sqrt(bundle.edges.length);
    const avg = (end: "source" | "target") =>
      bundle.edges.reduce((s, ei) => {
        const e = edges[ei]!;
        const node = nodes[idx.get(e[end])!]!;
        return s + portOf(node, end === "source" ? e.sourcePort : e.targetPort);
      }, 0) / bundle.edges.length;
    const oU = bundle.reversed ? avg("target") : avg("source");
    const oV = bundle.reversed ? avg("source") : avg("target");
    if (rankOf[u] === rankOf[v]) {
      bundle.flat = true;
      bundle.chain = [u, v];
      return;
    }
    const chain = [u];
    const width = Math.max(1, bundle.edges.length) * options.edgeGap;
    for (let r = rankOf[u]! + 1; r < rankOf[v]!; r++) {
      chain.push(lnodes.length);
      lnodes.push({ real: -1, rank: r, breadth: width, pos: 0 });
    }
    chain.push(v);
    bundle.chain = chain;
    for (let k = 0; k + 1 < chain.length; k++) {
      segs.push({
        bundle: b,
        top: chain[k]!,
        bottom: chain[k + 1]!,
        weight: w,
        oTop: k === 0 ? oU : 0,
        oBottom: k + 2 === chain.length ? oV : 0,
      });
    }
  });
  const ranks = Math.max(0, ...rankOf) + 1;
  const layers: number[][] = Array.from({ length: ranks }, () => []);
  lnodes.forEach((node, i) => layers[node.rank]!.push(i));
  const down: number[][] = lnodes.map(() => []);
  const up: number[][] = lnodes.map(() => []);
  segs.forEach((s, si) => {
    down[s.top]!.push(si);
    up[s.bottom]!.push(si);
  });

  // ---- ordering: weighted barycenter sweeps, port-aware, then transpose; keep the best order seen.
  const orderIndex = new Float64Array(lnodes.length);
  const setIndex = () => layers.forEach((layer) => layer.forEach((x, k) => (orderIndex[x] = k)));
  const frac = (x: number, o: number) => (o / Math.max(1, lnodes[x]!.breadth)) * 0.9;
  if (hints && hints.pos.size > 0) {
    // Seed from the previous positions; a new node takes the mean of its hinted neighbours.
    const key = new Float64Array(lnodes.length).fill(NaN);
    lnodes.forEach((node, x) => {
      if (node.real >= 0) {
        const h = hints.pos.get(nodes[node.real]!.id);
        if (h !== undefined) key[x] = h;
      }
    });
    for (let pass = 0; pass < 3; pass++) {
      lnodes.forEach((_, x) => {
        if (!Number.isNaN(key[x]!)) return;
        const ks = [...up[x]!.map((s) => key[segs[s]!.top]!), ...down[x]!.map((s) => key[segs[s]!.bottom]!)].filter(
          (k) => !Number.isNaN(k),
        );
        if (ks.length) key[x] = ks.reduce((a, b) => a + b, 0) / ks.length;
      });
    }
    for (const layer of layers) layer.sort((a, b) => (Number.isNaN(key[a]!) ? 1e12 : key[a]!) - (Number.isNaN(key[b]!) ? 1e12 : key[b]!));
  } else {
    // DFS order from the first rank.
    const seen = new Uint8Array(lnodes.length);
    const ord: number[] = [];
    const visit = (x: number) => {
      const stack = [x];
      while (stack.length) {
        const y = stack.pop()!;
        if (seen[y]) continue;
        seen[y] = 1;
        ord.push(y);
        for (const s of down[y]!) stack.push(segs[s]!.bottom);
      }
    };
    for (const layer of layers) for (const x of layer) visit(x);
    const at = new Map(ord.map((x, k) => [x, k]));
    for (const layer of layers) layer.sort((a, b) => at.get(a)! - at.get(b)!);
  }
  setIndex();
  const crossingsBetween = (r: number): number => {
    // Barth, Juenger and Mutzel's accumulator count, weighted, on port-refined positions.
    const list: [number, number, number][] = [];
    for (const x of layers[r]!) for (const s of down[x]!) {
      const seg = segs[s]!;
      list.push([orderIndex[x]! + frac(x, seg.oTop), orderIndex[seg.bottom]! + frac(seg.bottom, seg.oBottom), seg.weight]);
    }
    if (list.length < 2) return 0;
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const souths = [...new Set(list.map((l) => l[1]))].sort((a, b) => a - b);
    const rankOfSouth = new Map(souths.map((s, k) => [s, k + 1]));
    const tree = new Float64Array(souths.length + 1);
    let total = 0;
    let sum = 0;
    for (const [, s, w] of list) {
      const k = rankOfSouth.get(s)!;
      let le = 0;
      for (let j = k; j > 0; j -= j & -j) le += tree[j]!;
      total += w * (sum - le);
      for (let j = k; j < tree.length; j += j & -j) tree[j]! += w;
      sum += w;
    }
    return total;
  };
  const allCrossings = () => {
    let c = 0;
    for (let r = 0; r + 1 < ranks; r++) c += crossingsBetween(r);
    return c;
  };
  const pairCrossings = (a: number, b: number): number => {
    // Crossings among the segments of a and b, a placed before b, with both neighbouring layers.
    let c = 0;
    for (const [lists, end, off] of [
      [up, "top", "oTop"],
      [down, "bottom", "oBottom"],
    ] as const) {
      for (const sa of lists[a]!) {
        const A = segs[sa]!;
        const pa = orderIndex[A[end]]! + frac(A[end], A[off]);
        for (const sb of lists[b]!) {
          const B = segs[sb]!;
          const pb = orderIndex[B[end]]! + frac(B[end], B[off]);
          if (pa > pb) c += A.weight * B.weight;
        }
      }
    }
    return c;
  };
  let best = layers.map((layer) => [...layer]);
  let bestCount = allCrossings();
  for (let it = 0; it < options.sweeps && bestCount > 0; it++) {
    const downward = it % 2 === 0;
    const rs = downward ? [...Array(ranks).keys()].slice(1) : [...Array(ranks).keys()].reverse().slice(1);
    for (const r of rs) {
      const layer = layers[r]!;
      const bary = new Map<number, number>();
      for (const x of layer) {
        const list = downward ? up[x]! : down[x]!;
        let s = 0;
        let w = 0;
        for (const si of list) {
          const seg = segs[si]!;
          const other = downward ? seg.top : seg.bottom;
          const off = downward ? seg.oTop : seg.oBottom;
          s += seg.weight * (orderIndex[other]! + frac(other, off));
          w += seg.weight;
        }
        bary.set(x, w > 0 ? s / w : orderIndex[x]!);
      }
      layer.sort((a, b) => bary.get(a)! - bary.get(b)!);
      layer.forEach((x, k) => (orderIndex[x] = k));
    }
    // Transpose (Gansner et al. 1993, section 3): swap neighbours while it lowers crossings.
    for (let pass = 0, improved = true; improved && pass < 4; pass++) {
      improved = false;
      for (const layer of layers) {
        for (let k = 0; k + 1 < layer.length; k++) {
          const a = layer[k]!;
          const b = layer[k + 1]!;
          if (pairCrossings(b, a) < pairCrossings(a, b)) {
            layer[k] = b;
            layer[k + 1] = a;
            orderIndex[a] = k + 1;
            orderIndex[b] = k;
            improved = true;
          }
        }
      }
    }
    const count = allCrossings();
    if (count < bestCount) {
      bestCount = count;
      best = layers.map((layer) => [...layer]);
    }
  }
  best.forEach((layer, r) => (layers[r] = layer));
  setIndex();
  const tOrder = performance.now();

  // ---- placement: min sum w (p_u + o_u - p_v - o_v)^2 + s (p - hint)^2, with ordered separation in each rank,
  // by gradient projection with an exact per-rank projection (pool adjacent violators).
  const m = lnodes.length;
  const x = new Float64Array(m);
  const sep: Float64Array[] = layers.map((layer) => {
    const c = new Float64Array(layer.length);
    for (let k = 1; k < layer.length; k++) {
      const a = lnodes[layer[k - 1]!]!;
      const b = lnodes[layer[k]!]!;
      const gap = a.real >= 0 && b.real >= 0 ? options.nodeGap : options.edgeGap;
      c[k] = c[k - 1]! + (a.breadth + b.breadth) / 2 + gap;
    }
    return c;
  });
  const anchorW = new Float64Array(m);
  const anchorAt = new Float64Array(m);
  const anchorIdx = options.anchor === undefined ? undefined : idx.get(options.anchor);
  if (anchorIdx !== undefined) anchorW[anchorIdx] = 100;
  if (hints && options.stability > 0) {
    lnodes.forEach((node, i) => {
      if (node.real < 0) return;
      const h = hints.pos.get(nodes[node.real]!.id);
      if (h !== undefined && i !== anchorIdx) {
        anchorW[i] = options.stability;
        anchorAt[i] = h;
      }
    });
  }
  // Long-edge straightening weights after Gansner et al.: 1 real-real, 2 with one dummy, 8 dummy-dummy.
  const omega = (s: Seg) => {
    const d = (lnodes[s.top]!.real < 0 ? 1 : 0) + (lnodes[s.bottom]!.real < 0 ? 1 : 0);
    return s.weight * (d === 0 ? 1 : d === 1 ? 2 : 8);
  };
  const ws = segs.map(omega);
  layers.forEach((layer, r) => {
    const c = sep[r]!;
    const mid = (c[c.length - 1] ?? 0) / 2;
    layer.forEach((v, k) => (x[v] = hints?.pos.size ? (anchorAt[v] || c[k]! - mid) : c[k]! - mid));
  });
  const EPS = 1e-6;
  const grad = (p: Float64Array, g: Float64Array) => {
    for (let i = 0; i < m; i++) g[i] = 2 * anchorW[i]! * (p[i]! - anchorAt[i]!) + 2 * EPS * p[i]!;
    segs.forEach((s, si) => {
      const d = 2 * ws[si]! * (p[s.top]! + s.oTop - p[s.bottom]! - s.oBottom);
      g[s.top]! += d;
      g[s.bottom]! -= d;
    });
  };
  const quad = (d: Float64Array) => {
    let q = 0;
    for (let i = 0; i < m; i++) q += 2 * (anchorW[i]! + EPS) * d[i]! * d[i]!;
    segs.forEach((s, si) => {
      const t = d[s.top]! - d[s.bottom]!;
      q += 2 * ws[si]! * t * t;
    });
    return q;
  };
  // Hessian diagonal: the scaling of the gradient step and the norm of the projection.
  const diag = new Float64Array(m);
  for (let i = 0; i < m; i++) diag[i] = SCALED ? 2 * (anchorW[i]! + EPS) : 1;
  if (SCALED) segs.forEach((s, si) => {
    diag[s.top]! += 2 * ws[si]!;
    diag[s.bottom]! += 2 * ws[si]!;
  });
  const project = (p: Float64Array) => {
    layers.forEach((layer, r) => {
      const c = sep[r]!;
      // Weighted isotonic regression of z_k = p_k - c_k (non-decreasing), then add c back.
      const val: number[] = [];
      const wt: number[] = [];
      const cnt: number[] = [];
      for (let k = 0; k < layer.length; k++) {
        val.push(p[layer[k]!]! - c[k]!);
        wt.push(diag[layer[k]!]!);
        cnt.push(1);
        while (val.length > 1 && val[val.length - 2]! > val[val.length - 1]!) {
          const v2 = val.pop()!;
          const w2 = wt.pop()!;
          const c2 = cnt.pop()!;
          const v1 = val.pop()!;
          const w1 = wt.pop()!;
          const c1 = cnt.pop()!;
          val.push((v1 * w1 + v2 * w2) / (w1 + w2));
          wt.push(w1 + w2);
          cnt.push(c1 + c2);
        }
      }
      let k = 0;
      val.forEach((v, bi) => {
        for (let j = 0; j < cnt[bi]!; j++, k++) p[layer[k]!] = v + c[k]!;
      });
    });
  };
  const objective = (p: Float64Array) => {
    let f = 0;
    for (let i = 0; i < m; i++) f += anchorW[i]! * (p[i]! - anchorAt[i]!) ** 2 + EPS * p[i]! ** 2;
    segs.forEach((s, si) => {
      f += ws[si]! * (p[s.top]! + s.oTop - p[s.bottom]! - s.oBottom) ** 2;
    });
    return f;
  };
  project(x);
  const g = new Float64Array(m);
  const d = new Float64Array(m);
  const trial = new Float64Array(m);
  const sg = new Float64Array(m);
  let gpIterations = 0;
  for (; gpIterations < GP_MAX; gpIterations++) {
    grad(x, g);
    let gg = 0;
    for (let i = 0; i < m; i++) {
      sg[i] = g[i]! / diag[i]!;
      gg += g[i]! * sg[i]!;
    }
    const gAg = quad(sg);
    if (gg < 1e-9 || gAg <= 0) break;
    const alpha = gg / gAg;
    for (let i = 0; i < m; i++) trial[i] = x[i]! - alpha * sg[i]!;
    project(trial);
    let gd = 0;
    let moved = 0;
    for (let i = 0; i < m; i++) {
      d[i] = trial[i]! - x[i]!;
      gd += g[i]! * d[i]!;
      moved = Math.max(moved, Math.abs(d[i]!));
    }
    if (moved < 0.05) break;
    const dAd = quad(d);
    const beta = dAd > 0 ? Math.min(1, Math.max(0, -gd / dAd)) : 1;
    for (let i = 0; i < m; i++) x[i]! += beta * d[i]!;
    // Stop when an iteration lowers the objective by less than a millionth of its value (f drops by -b*gd - b^2 dAd/2).
    const drop = -(beta * gd) - (beta * beta * dAd) / 2;
    const f = objective(x);
    if (drop <= 1e-6 * Math.max(1, f)) break;
  }
  // Translate: the anchor at 0 when given, else the smallest leading edge at 0.
  const shift = anchorIdx !== undefined ? x[anchorIdx]! : Math.min(...lnodes.map((node, i) => x[i]! - node.breadth / 2));
  for (let i = 0; i < m; i++) x[i]! -= shift;
  lnodes.forEach((node, i) => (node.pos = x[i]!));
  const tPlace = performance.now();

  // ---- channel routing between each pair of ranks: hyperedges by source point, crossing-ordered tracks.
  const depthOf = (r: number) =>
    Math.max(0, ...layers[r]!.filter((v) => lnodes[v]!.real >= 0).map((v) => nodes[lnodes[v]!.real]!.depth));
  interface Hyper {
    tops: number[];
    bottoms: number[];
    lo: number;
    hi: number;
    track: number;
    members: { edge: number; top: number; bottom: number }[];
  }
  const memberPoint = (b: number, k: number, ei: number) => {
    // The point of input edge ei where the bundle's chain meets chain[k].
    const bundle = bundles[b]!;
    const v = bundle.chain[k]!;
    const node = lnodes[v]!;
    const e = edges[ei]!;
    if (node.real < 0) {
      const slot = bundle.edges.indexOf(ei);
      return node.pos - node.breadth / 2 + (slot + 0.5) * options.edgeGap;
    }
    const first = k === 0;
    const isSource = bundle.reversed ? !first : first;
    const real = nodes[node.real]!;
    return node.pos + portOf(real, isSource ? e.sourcePort : e.targetPort);
  };
  const channelHypers: Hyper[][] = Array.from({ length: ranks }, () => []);
  bundles.forEach((bundle, b) => {
    for (let k = 0; k + 1 < bundle.chain.length; k++) {
      const r = lnodes[bundle.chain[k]!]!.rank;
      for (const ei of bundle.edges) {
        const top = memberPoint(b, k, ei);
        const bottom = memberPoint(b, k + 1, ei);
        channelHypers[r]!.push({
          tops: [top],
          bottoms: bundle.flat ? [] : [bottom],
          lo: 0,
          hi: 0,
          track: -1,
          members: [{ edge: ei, top, bottom }],
        });
        if (bundle.flat) channelHypers[r]!.at(-1)!.tops.push(bottom);
      }
    }
  });
  let crossings = 0;
  let totalTracks = 0;
  const channelWidth: number[] = [];
  const trackOf = new Map<string, number>();
  channelHypers.forEach((raw, r) => {
    // Merge hyperedges that leave the same point.
    const bySource = new Map<string, Hyper>();
    const straight: number[] = [];
    const list: Hyper[] = [];
    for (const h of raw) {
      const key = `${Math.round(h.tops[0]! * 10)}|${h.bottoms.length === 0 ? "flat" : ""}`;
      const seen = bySource.get(key);
      if (seen && h.bottoms.length) {
        seen.bottoms.push(...h.bottoms);
        seen.members.push(...h.members);
      } else {
        bySource.set(key, h);
        list.push(h);
      }
    }
    const routed: Hyper[] = [];
    for (const h of list) {
      const all = [...h.tops, ...h.bottoms];
      h.lo = Math.min(...all);
      h.hi = Math.max(...all);
      if (h.hi - h.lo < 0.5) straight.push(h.tops[0]!);
      else routed.push(h);
    }
    const inside = (p: number, h: Hyper) => p > h.lo + 0.25 && p < h.hi - 0.25;
    const above = (a: Hyper, b: Hyper) =>
      b.tops.filter((t) => inside(t, a)).length + a.bottoms.filter((t) => inside(t, b)).length;
    // Overlapping pairs by a sweep over interval starts.
    routed.sort((a, b) => a.lo - b.lo);
    const pairs: [number, number, number][] = [];
    const prefer: number[][] = routed.map(() => []);
    const indeg = new Int32Array(routed.length);
    for (let i = 0; i < routed.length; i++) {
      for (let j = i + 1; j < routed.length && routed[j]!.lo < routed[i]!.hi; j++) {
        const ab = above(routed[i]!, routed[j]!);
        const ba = above(routed[j]!, routed[i]!);
        pairs.push([i, j, 0]);
        if (ab < ba) {
          prefer[i]!.push(j);
          indeg[j]!++;
        } else if (ba < ab) {
          prefer[j]!.push(i);
          indeg[i]!++;
        }
      }
    }
    // Topological order of the preference graph; a cycle is broken at the node with fewest unmet predecessors.
    const done = new Uint8Array(routed.length);
    const topo: number[] = [];
    const ready = routed.map((_, i) => i).filter((i) => indeg[i] === 0);
    while (topo.length < routed.length) {
      let next = ready.pop();
      if (next === undefined) {
        let bestI = -1;
        for (let i = 0; i < routed.length; i++) if (!done[i] && (bestI < 0 || indeg[i]! < indeg[bestI]!)) bestI = i;
        next = bestI;
      }
      if (done[next]) continue;
      done[next] = 1;
      topo.push(next);
      for (const j of prefer[next]!) if (!done[j] && --indeg[j]! === 0) ready.push(j);
    }
    // Tracks: below every overlapping predecessor already placed, then the first free track (left edge).
    const tracks: Hyper[][] = [];
    const placed: number[] = [];
    for (const i of topo) {
      const h = routed[i]!;
      let t = 0;
      for (const j of placed) {
        const o = routed[j]!;
        if (o.lo < h.hi && h.lo < o.hi && prefer[j]!.includes(i)) t = Math.max(t, o.track + 1);
      }
      while (tracks[t]?.some((o) => o.lo < h.hi + options.edgeGap / 2 && h.lo < o.hi + options.edgeGap / 2)) t++;
      (tracks[t] ??= []).push(h);
      h.track = t;
      placed.push(i);
    }
    for (const [i, j] of pairs) {
      const a = routed[i]!;
      const b = routed[j]!;
      crossings += a.track < b.track ? above(a, b) : above(b, a);
    }
    for (const s of straight) for (const h of routed) if (inside(s, h)) crossings++;
    totalTracks += tracks.length;
    channelWidth[r] = Math.max(options.minChannel, (tracks.length + 1) * options.edgeGap);
    for (const h of routed) for (const mbr of h.members) trackOf.set(`${r}|${mbr.edge}`, h.track);
  });

  // ---- coordinates along the rank axis, then polylines.
  const layerStart: number[] = [];
  let l = 0;
  for (let r = 0; r < ranks; r++) {
    layerStart[r] = l;
    l += depthOf(r) + (channelWidth[r] ?? options.minChannel);
  }
  const centre = new Map<string, { l: number; p: number }>();
  const rank = new Map<string, number>();
  lnodes.forEach((node) => {
    if (node.real < 0) return;
    const real = nodes[node.real]!;
    centre.set(real.id, { l: layerStart[node.rank]! + real.depth / 2, p: node.pos });
    rank.set(real.id, node.rank);
  });
  const paths = new Map<string, { l: number; p: number }[]>();
  let bends = 0;
  let length = 0;
  bundles.forEach((bundle, b) => {
    for (const ei of bundle.edges) {
      const pts: { l: number; p: number }[] = [];
      for (let k = 0; k + 1 < bundle.chain.length; k++) {
        const v = bundle.chain[k]!;
        const r = lnodes[v]!.rank;
        const top = memberPoint(b, k, ei);
        const bottom = memberPoint(b, k + 1, ei);
        const chStart = layerStart[r]! + depthOf(r);
        const nodeOut = lnodes[v]!.real >= 0 ? layerStart[r]! + nodes[lnodes[v]!.real]!.depth : chStart;
        if (k === 0) pts.push({ l: nodeOut, p: top });
        const track = trackOf.get(`${r}|${ei}`);
        if (track !== undefined) {
          const tl = chStart + (track + 1) * options.edgeGap;
          pts.push({ l: tl, p: top }, { l: tl, p: bundle.flat ? bottom : bottom });
          bends += 2;
        }
        const w = bundle.chain[k + 1]!;
        if (!bundle.flat) {
          const inAt = layerStart[r + 1]!;
          pts.push({ l: inAt, p: bottom });
          if (lnodes[w]!.real < 0) pts.push({ l: inAt + depthOf(r + 1), p: bottom });
        } else {
          pts.push({ l: nodeOut, p: bottom });
        }
      }
      for (let k = 1; k < pts.length; k++) {
        length += Math.abs(pts[k]!.l - pts[k - 1]!.l) + Math.abs(pts[k]!.p - pts[k - 1]!.p);
      }
      paths.set(edges[ei]!.id, bundle.reversed ? pts.reverse() : pts);
    }
  });
  const tRoute = performance.now();

  // ---- metrics.
  let minP = Infinity;
  let maxP = -Infinity;
  let nodeArea = 0;
  for (const node of nodes) {
    const c = centre.get(node.id)!;
    minP = Math.min(minP, c.p - node.breadth / 2);
    maxP = Math.max(maxP, c.p + node.breadth / 2);
    nodeArea += node.breadth * node.depth;
  }
  const area = (maxP - minP) * l;
  let overlaps = 0;
  for (const layer of layers) {
    const real = layer.filter((v) => lnodes[v]!.real >= 0);
    for (let k = 1; k < real.length; k++) {
      const a = lnodes[real[k - 1]!]!;
      const b = lnodes[real[k]!]!;
      if (b.pos - b.breadth / 2 < a.pos + a.breadth / 2 - 0.5) overlaps++;
    }
  }
  const hintsOut: Hints = { rank, pos: new Map([...centre].map(([id, c]) => [id, c.p])) };
  return {
    rank,
    centre,
    paths,
    stats: {
      ranks,
      dummies: lnodes.length - n,
      nsIterations: ns.iterations,
      gpIterations,
      crossings,
      bends,
      length: Math.round(length),
      area: Math.round(area),
      compactness: Number((nodeArea / Math.max(1, area)).toFixed(3)),
      overlaps,
      tracks: totalTracks,
      objective: Math.round(objective(x)),
    },
    ms: {
      rank: tRank - t0,
      order: tOrder - tRank,
      place: tPlace - tOrder,
      route: tRoute - tPlace,
      total: tRoute - t0,
    },
    hints: hintsOut,
  };
}
