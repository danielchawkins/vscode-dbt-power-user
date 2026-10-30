/**
 * The emphasis of the drawn graph: the path of the focused card, the cards and edges dimmed off it, and the edges of
 * hub cards. It reads the drawn `[parent, child]` pairs, how many connections each card has in the known data, and the
 * emphasis settings. It moves no card, so it is never part of the layout input: `emphasize` restyles a built flow.
 */

/** A connection, as `[parent, child]`. */
export type Pair = readonly [string, string];

/** The emphasis settings, with the card the path follows (the hovered card, else the selected one). */
export interface Emphasis {
  focus?: string | undefined;
  pathHighlight: boolean;
  dimOffPath: boolean;
  hubDeemphasis: boolean;
  /** A card with more connections than this is a hub. */
  maxNeighbours: number;
}

/** What the emphasis draws for each card and each edge. */
export interface EmphasisView {
  /** Whether a card is off the highlighted path, and so dimmed. */
  dimmedCard: (table: string) => boolean;
  /** Whether a card is on the highlighted path. */
  pathCard: (table: string) => boolean;
  /** Whether an edge is on the highlighted path. */
  pathEdge: (parent: string, child: string) => boolean;
  /** Whether an edge is off the highlighted path, and so dimmed. */
  dimmedEdge: (parent: string, child: string) => boolean;
  /** Whether an edge touches a hub card, and so draws thinner and lighter. */
  hubEdge: (parent: string, child: string) => boolean;
}

/**
 * How many connections each card has: the pairs it is in. Pass every known pair, not the drawn ones, so a card whose
 * neighbours are capped or grouped still counts them.
 */
export function connectionCounts(pairs: readonly Pair[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [parent, child] of pairs) {
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
    counts.set(child, (counts.get(child) ?? 0) + 1);
  }
  return counts;
}

/** The cards reachable from `start` by following `next`, not counting `start` itself. */
function reachable(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    for (const card of next.get(stack.pop()!) ?? []) {
      if (!seen.has(card)) {
        seen.add(card);
        stack.push(card);
      }
    }
  }
  return seen;
}

/**
 * The emphasis of the drawn `edges`. With a focus, the highlighted path is the focus and every card upstream or
 * downstream of it; an edge is on it when its child reaches the focus or the focus reaches its parent. `connections`
 * says how many connections each card has (see `connectionCounts`); a card with more than `maxNeighbours` is a hub.
 */
export function emphasisOf(
  edges: readonly Pair[],
  connections: ReadonlyMap<string, number>,
  emphasis: Emphasis,
): EmphasisView {
  const focus = emphasis.focus;
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const [parent, child] of edges) {
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
    parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
  }
  const upstream =
    focus === undefined ? new Set<string>() : reachable(focus, parentsOf);
  const downstream =
    focus === undefined ? new Set<string>() : reachable(focus, childrenOf);
  const onPath = (table: string) =>
    table === focus || upstream.has(table) || downstream.has(table);
  const pathEdge = (parent: string, child: string) =>
    focus !== undefined &&
    (child === focus ||
      upstream.has(child) ||
      parent === focus ||
      downstream.has(parent));
  const highlighting = focus !== undefined && emphasis.pathHighlight;
  const dimming = focus !== undefined && emphasis.dimOffPath;
  const hubs = new Set(
    emphasis.hubDeemphasis
      ? [...connections]
          .filter(([, count]) => count > emphasis.maxNeighbours)
          .map(([table]) => table)
      : [],
  );
  return {
    dimmedCard: (table) => dimming && !onPath(table),
    pathCard: (table) => highlighting && onPath(table),
    pathEdge: (parent, child) => highlighting && pathEdge(parent, child),
    dimmedEdge: (parent, child) => dimming && !pathEdge(parent, child),
    hubEdge: (parent, child) => hubs.has(parent) || hubs.has(child),
  };
}
