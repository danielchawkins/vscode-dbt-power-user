/**
 * Generation ranking for the layered layout: each node's row relative to the start node, from its longest paths up
 * and down the edges, then oriented so every edge points down.
 */

/** The longest path from the start node to every node reachable through `next`. */
function longestPaths(
  from: string,
  next: ReadonlyMap<string, readonly string[]>,
  limit: number,
): Map<string, number> {
  const distance = new Map<string, number>([[from, 0]]);
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop() ?? from;
    const here = distance.get(id) ?? 0;
    // A cycle would otherwise grow forever; a DAG never gets past the node count.
    if (here + 1 > limit) {
      continue;
    }
    for (const following of next.get(id) ?? []) {
      if ((distance.get(following) ?? -1) < here + 1) {
        distance.set(following, here + 1);
        stack.push(following);
      }
    }
  }
  return distance;
}

function adjacency(
  pairs: readonly (readonly [string, string])[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}

/** The generation a node starts with from its longest paths: the start itself, above, below, or none yet. */
function seededGeneration(
  id: string,
  start: string,
  up: ReadonlyMap<string, number>,
  down: ReadonlyMap<string, number>,
): number | undefined {
  if (id === start) {
    return 0;
  }
  if (up.has(id)) {
    return -(up.get(id) ?? 0);
  }
  if (down.has(id)) {
    return down.get(id) ?? 0;
  }
  return undefined;
}

/** One sweep that places each unplaced parent just above its placed child. */
function placeParentsAbove(
  edges: readonly (readonly [string, string])[],
  gen: Map<string, number>,
): void {
  for (const [parent, child] of edges) {
    const childGen = gen.get(child);
    if (!gen.has(parent) && childGen !== undefined) {
      const above = childGen - 1;
      gen.set(parent, above === 0 ? -1 : above);
    }
  }
}

/** One sweep that moves each edge's ends until the child sits below its parent. */
function orientEdges(
  start: string,
  edges: readonly (readonly [string, string])[],
  gen: Map<string, number>,
): void {
  for (const [parent, child] of edges) {
    const parentGen = gen.get(parent) ?? 0;
    const childGen = gen.get(child) ?? 0;
    if (parentGen < childGen) {
      continue;
    }
    if (child === start || parentGen < 0) {
      gen.set(parent, childGen - 1);
    } else {
      gen.set(child, parentGen + 1);
    }
  }
}

/**
 * Each node's generation from the start: its longest path up (negative) or down (positive).
 * Nodes neither above nor below the start sit just above their first placed child, never in the start's row.
 */
export function generations(
  start: string,
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
): Map<string, number> {
  const limit = ids.length + 1;
  const parents = adjacency(
    edges.map(([parent, child]) => [child, parent] as const),
  );
  const children = adjacency(edges);
  const up = longestPaths(start, parents, limit);
  const down = longestPaths(start, children, limit);

  const gen = new Map<string, number>();
  for (const id of ids) {
    const seeded = seededGeneration(id, start, up, down);
    if (seeded !== undefined) {
      gen.set(id, seeded);
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    placeParentsAbove(edges, gen);
  }
  for (const id of ids) {
    if (!gen.has(id)) {
      gen.set(id, 1);
    }
  }
  // Every edge points down: push a child below its parent, or a parent above its child. One pass per node is enough.
  ids.forEach(() => orientEdges(start, edges, gen));
  return gen;
}
