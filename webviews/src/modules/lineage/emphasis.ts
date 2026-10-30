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
  /** A card with more parents or more children than this is a hub; 0 draws every neighbour, so no card is one. */
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

/** How many neighbours a card has in each direction: its parents and its children in the known pairs. */
export interface Neighbours {
  parents: number;
  children: number;
}

/**
 * How many neighbours each card has, by direction: the pairs it is in. Pass every known pair, not the drawn ones, so a
 * card whose neighbours are capped or grouped still counts them.
 */
export function connectionCounts(
  pairs: readonly Pair[],
): Map<string, Neighbours> {
  const counts = new Map<string, Neighbours>();
  const count = (table: string) => {
    const known = counts.get(table) ?? { parents: 0, children: 0 };
    counts.set(table, known);
    return known;
  };
  for (const [parent, child] of pairs) {
    count(parent).children += 1;
    count(child).parents += 1;
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
 * says how many neighbours each card has in each direction (see `connectionCounts`); a hub is a card with more than
 * `maxNeighbours` parents, or more than `maxNeighbours` children.
 */
export function emphasisOf(
  edges: readonly Pair[],
  connections: ReadonlyMap<string, Neighbours>,
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
  // A hub has more parents, or more children, than one expansion draws; a cap of 0 draws all, so no card is a hub.
  const isHub = ({ parents, children }: Neighbours) =>
    emphasis.maxNeighbours > 0 &&
    (parents > emphasis.maxNeighbours || children > emphasis.maxNeighbours);
  const hubs = new Set(
    emphasis.hubDeemphasis
      ? [...connections]
          .filter(([, counts]) => isHub(counts))
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
