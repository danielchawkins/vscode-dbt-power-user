import { filteredOutTables } from "./filteredOut";
import type { Direction, GraphState } from "./graphState";
import { groupedNeighbours } from "./grouping";

/**
 * The lineage projection: which cards the view draws, decided once from the graph state. The whole-project and the
 * neighbourhood views both go through `visibleOf`, so the cards, the edges and the expanders cannot disagree.
 */

export const expansionKey = (direction: Direction, table: string): string =>
  `${direction === "children" ? "c" : "p"}:${table}`;

export const parseExpansion = (
  key: string,
): [Direction, string] | undefined => {
  const [prefix, table] = [key.slice(0, 2), key.slice(2)];
  if (!table) {
    return undefined;
  }
  return prefix === "c:"
    ? ["children", table]
    : prefix === "p:"
      ? ["parents", table]
      : undefined;
};

export const isExpanded = (
  state: GraphState,
  direction: Direction,
  table: string,
): boolean => state.expansions.includes(expansionKey(direction, table));

/** The neighbours expansion `key` draws: all it fetched, or the first `shown[key]` of them, or its open buckets. */
export const drawnNeighbours = (state: GraphState, key: string): string[] => {
  const group = state.groups[key];
  if (group) {
    return groupedNeighbours(group);
  }
  const all = state.neighbours[key] ?? [];
  const limit = state.shown[key];
  return limit === undefined ? all : all.slice(0, limit);
};

/**
 * What the lineage view shows, decided once from the graph state. The cards and every edge (table, group and column)
 * read this one projection, so a card and an edge cannot disagree about what is visible.
 */
export interface Visible {
  /** The IDs of the drawn cards: the start table and each neighbour its expansions draw, filtered-out ones included. */
  drawn: Set<string>;
  /** The filtered-out cards: drawn as cards, with no edge. */
  filteredOut: Set<string>;
  /** Whether a drawn card takes part in edges: it is drawn and not filtered out. */
  hasEdges: (id: string) => boolean;
  /** Per expansion key, how many neighbours the card budget left out; the card reports them as capped. */
  capped: Record<string, number>;
}

/** The steps from a card to the cards next to it, given how many steps from the start it is. */
type Step = (id: string, level: number) => readonly string[];

/**
 * The cards reached from `sources`, each at its distance in steps, where each card reached by `step` is one step
 * further. A card in `blocked` is never reached. Each card keeps its nearest distance, so the steps are taken in order.
 */
function reachFrom(
  sources: ReadonlyMap<string, number>,
  step: Step,
  blocked: ReadonlySet<string>,
): Map<string, number> {
  const reached = new Map(sources);
  const rings: string[][] = [];
  for (const [id, level] of sources) {
    (rings[level] ??= []).push(id);
  }
  for (let level = 0; level < rings.length; level++) {
    for (const id of rings[level] ?? []) {
      if (reached.get(id) !== level) {
        continue;
      }
      for (const other of step(id, level)) {
        const near = reached.get(other);
        if (!blocked.has(other) && (near === undefined || near > level + 1)) {
          reached.set(other, level + 1);
          (rings[level + 1] ??= []).push(other);
        }
      }
    }
  }
  return reached;
}

const push = (map: Map<string, string[]>, key: string, value: string): void => {
  map.set(key, [...(map.get(key) ?? []), value]);
};

/** The parent and child steps over `pairs`, each `[parent, child]`. */
const pairSteps = (
  pairs: [string, string][],
): Record<Direction, (id: string) => string[]> => {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const [parent, child] of pairs) {
    push(children, parent, child);
    push(parents, child, parent);
  }
  return {
    parents: (id) => parents.get(id) ?? [],
    children: (id) => children.get(id) ?? [],
  };
};

const hiddenIdsOf = (state: GraphState): Set<string> =>
  new Set(state.hiddenCards.map((card) => card.id));

/** The start card, once the graph knows it; nothing is drawn before then. */
const startOf = (state: GraphState): string | undefined =>
  state.start && state.known[state.start] ? state.start : undefined;

/**
 * The cards of `ids` that only hidden cards lead to from `origins`: each one `step` reaches from an origin, but no path
 * from an unhidden origin reaches without passing through a hidden card.
 */
function cutOff(
  origins: readonly string[],
  step: Step,
  hidden: ReadonlySet<string>,
): Set<string> {
  const reachable = reachFrom(
    new Map(origins.map((id) => [id, 0])),
    step,
    new Set(),
  );
  const open = reachFrom(
    new Map(origins.filter((id) => !hidden.has(id)).map((id) => [id, 0])),
    step,
    hidden,
  );
  return new Set([...reachable.keys()].filter((id) => !open.has(id)));
}

/**
 * The whole project: every project table, each drawn on its own, minus the hidden ones. A table goes too when only
 * hidden cards lead to it: a descendant when every path to it from a source (a table with no parents) passes through a
 * hidden card, and an ancestor the same way with paths from a sink (a table with no children). A table no path reaches
 * from either side is kept. The start table is always drawn.
 */
function wholeOf(
  state: GraphState,
  start: string,
  hidden: ReadonlySet<string>,
): Pick<Visible, "drawn" | "capped"> {
  const steps = pairSteps(knownPairs(state));
  const project = state.project ?? [];
  const sources = project.filter((id) => steps.parents(id).length === 0);
  const sinks = project.filter((id) => steps.children(id).length === 0);
  const cutDown = cutOff(sources, steps.children, hidden);
  const cutUp = cutOff(sinks, steps.parents, hidden);
  const drawn = new Set([start]);
  for (const id of project) {
    if (!hidden.has(id) && !cutDown.has(id) && !cutUp.has(id)) {
      drawn.add(id);
    }
  }
  return { drawn, capped: {} };
}

/**
 * The neighbourhood: the cards the applied expansions reach from the start, both ways, ranked by distance, then
 * degree, then ID, and kept up to the card budget. The depths decide which expansions the panel applies (see
 * `build`), so the cards within the depths are the ones the expansions draw. A card left out is counted as capped on
 * the drawn card whose expansion reaches it.
 *
 * The depths are not applied here: an expansion the user opens by hand draws its neighbours past them, which is what
 * the expander is for. Only the cards the expansions reach are kept, up to the card budget.
 */
function neighbourhoodOf(
  state: GraphState,
  start: string,
  hidden: ReadonlySet<string>,
): Pick<Visible, "drawn" | "capped"> {
  const { cardBudget } = state.view;
  // A collapsed expansion draws nothing, even if its neighbours are still cached.
  const parents = (id: string): string[] =>
    isExpanded(state, "parents", id)
      ? drawnNeighbours(state, expansionKey("parents", id))
      : [];
  const children = (id: string): string[] =>
    isExpanded(state, "children", id)
      ? drawnNeighbours(state, expansionKey("children", id))
      : [];
  const reached = reachFrom(
    new Map([[start, 0]]),
    (id) => [...parents(id), ...children(id)],
    hidden,
  );
  const degree = (id: string): number => {
    const table = state.known[id];
    return table ? table.parentCount + table.childCount : 0;
  };
  const ranked = [...reached.keys()]
    .filter((id) => id !== start)
    .sort(
      (a, b) =>
        (reached.get(a) ?? 0) - (reached.get(b) ?? 0) ||
        degree(b) - degree(a) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );
  const keptIds = new Set(ranked.slice(0, Math.max(0, cardBudget - 1)));
  const drawn = new Set(
    [...reached.keys()].filter((id) => id === start || keptIds.has(id)),
  );
  const capped: Record<string, number> = {};
  for (const id of drawn) {
    for (const direction of ["parents", "children"] as const) {
      const key = expansionKey(direction, id);
      const left = (
        direction === "parents" ? parents(id) : children(id)
      ).filter((other) => reached.has(other) && !drawn.has(other)).length;
      if (left > 0) {
        capped[key] = left;
      }
    }
  }
  return { drawn, capped };
}

/**
 * The visible projection of `state`: see `Visible`. Nothing is drawn until the start table is known. The one
 * projection for both views: `state.view` decides which cards it keeps.
 */
export function visibleOf(state: GraphState): Visible {
  const hidden = hiddenIdsOf(state);
  const filteredOut = filteredOutTables(state);
  const start = startOf(state);
  const { drawn, capped } =
    start === undefined
      ? { drawn: new Set<string>(), capped: {} }
      : state.view.viewMode === "whole"
        ? wholeOf(state, start, hidden)
        : neighbourhoodOf(state, start, hidden);
  return {
    drawn,
    filteredOut,
    hasEdges: (id) => drawn.has(id) && !filteredOut.has(id),
    capped,
  };
}

/**
 * The cards within `levels` steps of the start, up and down, over every known pair and leaving hidden cards out. The
 * whole view fits to them, so it opens at the zoom a neighbourhood of that depth is read at.
 */
export function framedCards(state: GraphState, levels: number): Set<string> {
  const start = startOf(state);
  if (start === undefined) {
    return new Set();
  }
  const steps = pairSteps(knownPairs(state));
  const hidden = hiddenIdsOf(state);
  const origin = new Map([[start, 0]]);
  const up = reachFrom(
    origin,
    (id, level) => (level < levels ? steps.parents(id) : []),
    hidden,
  );
  const down = reachFrom(
    origin,
    (id, level) => (level < levels ? steps.children(id) : []),
    hidden,
  );
  return new Set([...up.keys(), ...down.keys()]);
}

/**
 * Every known `[parent, child]` pair, whatever its ends' state: each neighbour of an expansion, then each link. A pair
 * from a link and from an expansion is listed once.
 */
export function knownPairs(state: GraphState): [string, string][] {
  const pairs = new Map<string, [string, string]>();
  for (const [key, others] of Object.entries(state.neighbours)) {
    const parsed = parseExpansion(key);
    if (!parsed) {
      continue;
    }
    for (const other of others) {
      const edge: [string, string] =
        parsed[0] === "children" ? [parsed[1], other] : [other, parsed[1]];
      pairs.set(edge.join("\u0000"), edge);
    }
  }
  for (const [key, edge] of Object.entries(state.links)) {
    pairs.set(key, edge);
  }
  return [...pairs.values()];
}
