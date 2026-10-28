import type { Problem } from "./problem.js";

/** One pass's view of the ranks: nodes from left to right, each node's index and its left neighbour, and the gap. */
export interface Frame {
  layers: readonly (readonly number[])[];
  /** Index of each node in its rank. */
  pos: readonly number[];
  /** Left neighbour of each node in its rank, or -1 at the left end. */
  left: readonly number[];
  /** Least distance between each node's centre and its left neighbour's. */
  gap: readonly number[];
}

/** The block of each node after vertical alignment: its root, and the next node of its block in a cycle. */
export interface Blocks {
  root: readonly number[];
  align: readonly number[];
}

/** A node at the other end of a link, and the link itself. */
export interface Neighbour {
  node: number;
  link: number;
}

/** What a vertical alignment pass needs besides the frame: the neighbours it may join and the links it must not. */
export interface Pass {
  /** Per node, the neighbours on the side the pass aligns to. */
  adjacent: readonly (readonly Neighbour[])[];
  /** Links that may not be aligned (type 1 conflicts), by link index. */
  conflict: readonly boolean[];
  /** The ranks are processed from the top down, aligning each node to its upper neighbours. */
  fromAbove: boolean;
}

/**
 * The upper and lower neighbours of each node, from the links. Links join adjacent ranks only, so a node's upper
 * neighbours sit one rank above it.
 */
export function adjacency(problem: Problem): {
  above: Neighbour[][];
  below: Neighbour[][];
} {
  const n = problem.dummy.length;
  const above: Neighbour[][] = Array.from({ length: n }, () => []);
  const below: Neighbour[][] = Array.from({ length: n }, () => []);
  problem.links.forEach((link, s) => {
    above[link.bottom]!.push({ node: link.top, link: s });
    below[link.top]!.push({ node: link.bottom, link: s });
  });
  return { above, below };
}

/**
 * Marks the type 1 conflicts of Brandes and Köpf: a link between two real nodes that crosses a link between two
 * dummies is not aligned, so that the long edges that the dummies carry keep their straight runs. The result is per
 * link; a conflicting link is `true`.
 */
export function typeOneConflicts(problem: Problem): boolean[] {
  const n = problem.dummy.length;
  const pos = Array.from({ length: n }, () => 0);
  const rank = Array.from({ length: n }, () => 0);
  problem.layers.forEach((layer, r) =>
    layer.forEach((v, k) => {
      pos[v] = k;
      rank[v] = r;
    }),
  );
  const byRank: number[][] = problem.layers.map(() => []);
  problem.links.forEach((link, s) => byRank[rank[link.top]!]!.push(s));
  const inner = (s: number): boolean =>
    problem.dummy[problem.links[s]!.top]! &&
    problem.dummy[problem.links[s]!.bottom]!;
  const conflict = problem.links.map(() => false);
  for (const group of byRank) {
    const outer = group.filter((s) => !inner(s));
    for (const a of group.filter(inner)) {
      const la = problem.links[a]!;
      for (const b of outer) {
        const lb = problem.links[b]!;
        if (
          (pos[la.top]! - pos[lb.top]!) * (pos[la.bottom]! - pos[lb.bottom]!) <
          0
        ) {
          conflict[b] = true;
        }
      }
    }
  }
  return conflict;
}

/**
 * The ranks as one horizontal pass sees them. A mirrored pass reads each rank from right to left, so its coordinates
 * come out mirrored and must be negated.
 */
export function frameOf(problem: Problem, mirror: boolean): Frame {
  const n = problem.dummy.length;
  const layers = mirror
    ? problem.layers.map((layer) => [...layer].reverse())
    : problem.layers;
  const pos = Array.from({ length: n }, () => 0);
  const left = Array.from({ length: n }, () => -1);
  const gap = Array.from({ length: n }, () => 0);
  for (const layer of layers) {
    layer.forEach((v, k) => {
      pos[v] = k;
      if (k > 0) {
        const u = layer[k - 1]!;
        left[v] = u;
        // Mirrored, the left neighbour was the right one, so the gap is that neighbour's own left gap.
        gap[v] = mirror ? problem.gapLeft[u]! : problem.gapLeft[v]!;
      }
    });
  }
  return { layers, pos, left, gap };
}

/**
 * Vertical alignment (Brandes and Köpf, section 2.2): each node joins the block of one median neighbour in the rank it
 * is aligned to, when that neighbour is free, the link is not in conflict, and the joined neighbours keep their
 * left-to-right order.
 */
export function alignBlocks(frame: Frame, pass: Pass): Blocks {
  const n = frame.pos.length;
  const root = Array.from({ length: n }, (_, v) => v);
  const align = [...root];
  const ranks = frame.layers.map((_, r) => r);
  const order = pass.fromAbove ? ranks.slice(1) : ranks.slice(0, -1).reverse();
  for (const r of order) {
    let reach = -1;
    for (const v of frame.layers[r]!) {
      for (const nb of medianNeighbours(pass.adjacent[v]!, frame.pos)) {
        if (
          align[v] === v &&
          !pass.conflict[nb.link] &&
          reach < frame.pos[nb.node]!
        ) {
          align[nb.node] = v;
          root[v] = root[nb.node]!;
          align[v] = root[v]!;
          reach = frame.pos[nb.node]!;
        }
      }
    }
  }
  return { root, align };
}

/** The one or two median neighbours of a node, by position in their rank, in ascending order. */
function medianNeighbours(
  nbrs: readonly Neighbour[],
  pos: readonly number[],
): Neighbour[] {
  const sorted = nbrs.toSorted((a, b) => pos[a.node]! - pos[b.node]!);
  const d = sorted.length;
  if (d === 0) {
    return [];
  }
  return d % 2 === 1
    ? [sorted[(d - 1) / 2]!]
    : [sorted[d / 2 - 1]!, sorted[d / 2]!];
}
