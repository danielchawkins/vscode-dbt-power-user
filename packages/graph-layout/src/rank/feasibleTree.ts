import type { NetworkEdge } from "./networkSimplex.js";

interface TreeBuild {
  readonly edges: readonly NetworkEdge[];
  readonly incident: readonly (readonly number[])[];
  readonly ranks: number[];
  readonly inTree: boolean[];
  readonly members: number[];
  readonly treeEdges: number[];
}

/**
 * Builds a feasible tight spanning tree, as in Gansner, Koutsofios, North and Vo (1993). Starting from node 0, the
 * tree takes every edge with zero slack that reaches a new node. When none is left, the smallest slack on an edge
 * leaving the tree is closed by shifting the whole tree; that keeps every other edge feasible. `ranks` must be
 * feasible on entry and is updated in place. Returns the indices of the tree edges, one per node but the first.
 */
export function feasibleTree(
  count: number,
  edges: readonly NetworkEdge[],
  ranks: number[],
): number[] {
  const incident: number[][] = Array.from({ length: count }, () => []);
  edges.forEach((e, ei) => {
    incident[e.tail]!.push(ei);
    incident[e.head]!.push(ei);
  });
  const build: TreeBuild = {
    edges,
    incident,
    ranks,
    inTree: Array.from({ length: count }, (_, v) => v === 0),
    members: [0],
    treeEdges: [],
  };
  while (build.members.length < count) {
    growTight(build);
    if (build.members.length < count) {
      closeGap(build);
    }
  }
  return build.treeEdges;
}

const slack = (ranks: readonly number[], e: NetworkEdge): number =>
  ranks[e.head]! - ranks[e.tail]! - e.minLength;

/** Adds, by depth-first search, every node reachable from the tree over zero-slack edges. */
function growTight(build: TreeBuild): void {
  const stack = [...build.members];
  while (stack.length > 0) {
    const x = stack.pop()!;
    for (const ei of build.incident[x]!) {
      const e = build.edges[ei]!;
      const y = e.tail === x ? e.head : e.tail;
      if (build.inTree[y] || slack(build.ranks, e) !== 0) {
        continue;
      }
      build.inTree[y] = true;
      build.members.push(y);
      build.treeEdges.push(ei);
      stack.push(y);
    }
  }
}

/**
 * Shifts the tree so that the crossing edge with the least slack becomes tight. A tail inside the tree moves the tree
 * up by the slack; a head inside the tree moves it down. Every crossing edge stays feasible.
 */
function closeGap(build: TreeBuild): void {
  let best = -1;
  let bestSlack = Infinity;
  build.edges.forEach((e, ei) => {
    if (build.inTree[e.tail] === build.inTree[e.head]) {
      return;
    }
    const s = slack(build.ranks, e);
    if (s < bestSlack) {
      bestSlack = s;
      best = ei;
    }
  });
  if (best < 0) {
    throw new Error("ranking network is disconnected");
  }
  const shift = build.inTree[build.edges[best]!.tail] ? bestSlack : -bestSlack;
  for (const v of build.members) {
    build.ranks[v] = build.ranks[v]! + shift;
  }
}
