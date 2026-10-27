import { feasibleTree } from "./feasibleTree.js";
import { SpanningTree } from "./spanningTree.js";

/** A constraint `rank(head) - rank(tail) >= minLength`, with `weight` per unit of rank length. No self-loops. */
export interface NetworkEdge {
  tail: number;
  head: number;
  minLength: number;
  weight: number;
}

/**
 * Ranks `count` nodes so that every edge's span is at least its `minLength` and the weighted sum of spans is least,
 * by the network simplex method of Gansner, Koutsofios, North and Vo (1993). Ranks are integers with the lowest
 * real node at 0. Each pivot keeps the ranks feasible, so stopping at `maxIterations` gives a valid, possibly
 * non-optimal ranking. The result depends only on the inputs: the search order is fixed.
 */
export function networkSimplex(
  count: number,
  edges: readonly NetworkEdge[],
  maxIterations: number,
): number[] {
  if (count === 0) {
    return [];
  }
  const merged = mergeParallel(count, edges);
  const network = [...merged, ...rootEdges(count, merged)];
  const ranks = longestPathRanks(count + 1, network);
  const treeEdges = feasibleTree(count + 1, network, ranks);
  const tree = new SpanningTree(count + 1, network, treeEdges);
  pivot({ tree, edges: network, ranks }, maxIterations);
  return normalise(ranks.slice(0, count));
}

/** Parallel edges become one: weights add and the longest minimum length wins. */
function mergeParallel(
  count: number,
  edges: readonly NetworkEdge[],
): NetworkEdge[] {
  const byEnds = new Map<number, NetworkEdge>();
  for (const e of edges) {
    const key = e.tail * count + e.head;
    const seen = byEnds.get(key);
    if (seen === undefined) {
      byEnds.set(key, { ...e });
    } else {
      seen.weight += e.weight;
      seen.minLength = Math.max(seen.minLength, e.minLength);
    }
  }
  return [...byEnds.values()];
}

/**
 * Joins the components with a virtual root (node `count`): an edge of zero length and weight from the root to the
 * lowest node of each component, so the tree search reaches every node.
 */
function rootEdges(
  count: number,
  edges: readonly NetworkEdge[],
): NetworkEdge[] {
  const parent = Array.from({ length: count }, (_, v) => v);
  const find = (v: number): number => {
    let x = v;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const e of edges) {
    parent[find(e.tail)] = find(e.head);
  }
  const seen = new Set<number>();
  const joins: NetworkEdge[] = [];
  for (let v = 0; v < count; v++) {
    const root = find(v);
    if (seen.has(root)) {
      continue;
    }
    seen.add(root);
    joins.push({ tail: count, head: v, minLength: 0, weight: 0 });
  }
  return joins;
}

/** The longest path from a source to each node: feasible, and the start of the search. */
function longestPathRanks(
  count: number,
  edges: readonly NetworkEdge[],
): number[] {
  const out: number[][] = Array.from({ length: count }, () => []);
  const indegree: number[] = Array.from({ length: count }, () => 0);
  edges.forEach((e, ei) => {
    out[e.tail]!.push(ei);
    indegree[e.head]! += 1;
  });
  const ranks: number[] = Array.from({ length: count }, () => 0);
  const queue: number[] = [];
  for (let v = 0; v < count; v++) {
    if (indegree[v] === 0) {
      queue.push(v);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]!;
    for (const ei of out[v]!) {
      const e = edges[ei]!;
      ranks[e.head] = Math.max(ranks[e.head]!, ranks[v]! + e.minLength);
      indegree[e.head]! -= 1;
      if (indegree[e.head] === 0) {
        queue.push(e.head);
      }
    }
  }
  if (queue.length !== count) {
    throw new Error("ranking constraints form a cycle");
  }
  return ranks;
}

/** What a pivot works on: the tree, the constraints it was built from, and the ranks it keeps feasible. */
interface Pivoting {
  readonly tree: SpanningTree;
  readonly edges: readonly NetworkEdge[];
  readonly ranks: number[];
}

/** Exchanges tree edges while one has a negative cut value, up to `maxIterations` exchanges. */
function pivot(state: Pivoting, maxIterations: number): void {
  let cursor = 0;
  for (let i = 0; i < maxIterations; i++) {
    const slot = leavingSlot(state.tree, cursor);
    if (slot < 0) {
      return;
    }
    const leave = state.tree.treeEdges[slot]!;
    const enter = enteringEdge(state, leave);
    if (enter < 0) {
      throw new Error("ranking network is unbounded");
    }
    shiftSubtree(state, leave, enter);
    state.tree.exchange(leave, enter);
    cursor = slot + 1;
  }
}

/**
 * The first tree edge with a negative cut value, searching cyclically from `from`. Starting each search where the last
 * exchange left off keeps the pivots from cycling on one set of ties.
 */
function leavingSlot(tree: SpanningTree, from: number): number {
  const list = tree.treeEdges;
  for (let k = 0; k < list.length; k++) {
    const slot = (from + k) % list.length;
    if (tree.cut(list[slot]!) < 0) {
      return slot;
    }
  }
  return -1;
}

/**
 * The non-tree edge with the least slack that runs from the head side of `leave` to its tail side. Such an edge
 * exists whenever the cut value is negative. Ties go to the lowest edge index.
 */
function enteringEdge(state: Pivoting, leave: number): number {
  const { tree, edges, ranks } = state;
  const child = tree.childOf(leave);
  const headIsChild = child === edges[leave]!.head;
  let best = -1;
  let bestSlack = Infinity;
  edges.forEach((x, ei) => {
    if (tree.isTree(ei)) {
      return;
    }
    const tailBelow = tree.inSubtree(child, x.tail) === headIsChild;
    const headBelow = tree.inSubtree(child, x.head) === headIsChild;
    if (!tailBelow || headBelow) {
      return;
    }
    const s = ranks[x.head]! - ranks[x.tail]! - x.minLength;
    if (s < bestSlack) {
      bestSlack = s;
      best = ei;
    }
  });
  return best;
}

/**
 * Makes `enter` tight by moving the subtree below `leave` (the head side, when the head is the child). Its slack is
 * the shift, and the tree edge then leaves the cycle that `enter` closes.
 */
function shiftSubtree(state: Pivoting, leave: number, enter: number): void {
  const { tree, edges, ranks } = state;
  const x = edges[enter]!;
  const slack = ranks[x.head]! - ranks[x.tail]! - x.minLength;
  const child = tree.childOf(leave);
  const shift = child === edges[leave]!.head ? slack : -slack;
  ranks.forEach((_, v) => {
    if (tree.inSubtree(child, v)) {
      ranks[v] = ranks[v]! + shift;
    }
  });
}

/** Shifts the ranks so the lowest is 0. */
function normalise(ranks: number[]): number[] {
  const low = ranks.reduce((least, r) => Math.min(least, r), Infinity);
  return ranks.map((r) => r - low);
}
