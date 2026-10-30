import type { lineage } from "@fusion-power-user/webview-contract";
import { sameColumnName } from "./edgeIds";
import { bucketNeighbours } from "./grouping";
import {
  expansionKey,
  isExpanded,
  knownPairs,
  parseExpansion,
  visibleOf,
} from "./projection";

export {
  drawnNeighbours,
  expansionKey,
  framedCards,
  knownPairs,
  parseExpansion,
  visibleOf,
} from "./projection";
export type {
  Direction,
  Expansion,
  GraphState,
  TableColumn,
  ViewSettings,
} from "./graphState";
import type {
  Direction,
  Expansion,
  GraphState,
  TableColumn,
  ViewSettings,
} from "./graphState";

type LineageTable = lineage.LineageTable;
type LineageColumn = lineage.LineageColumn;

export interface GraphStore {
  get(): GraphState;
  update(change: (state: GraphState) => GraphState): void;
}

export type FetchNeighbours = (
  direction: Direction,
  table: string,
) => Promise<LineageTable[]>;
export type FetchColumns = (table: string) => Promise<LineageColumn[]>;
export type FetchConnected = (
  params: lineage.ConnectedColumnsParams,
) => Promise<lineage.ConnectedColumns>;
/** The data-flow `[parent, child]` pairs among `tables`. */
export type FetchEdges = (
  tables: readonly string[],
) => Promise<[string, string][]>;

/** The view a graph draws until told otherwise: the neighbourhood, with the defaults the settings resolve to. */
export const NEIGHBOURHOOD_VIEW: ViewSettings = {
  viewMode: "neighbourhood",
  upstreamDepth: 2,
  downstreamDepth: 2,
  cardBudget: 150,
};

export const emptyGraph = (
  start?: LineageTable,
  cap = 0,
  groupBy: "none" | "folder" = "none",
): GraphState => ({
  start: start?.table,
  known: start ? { [start.table]: start } : {},
  view: NEIGHBOURHOOD_VIEW,
  neighbours: {},
  expansions: [],
  columns: {},
  columnTables: [],
  columnEdges: [],
  errors: {},
  cancelled: {},
  pending: [],
  links: {},
  shown: {},
  cap,
  groupBy,
  groups: {},
  hiddenCards: [],
});

/** Whether the `direction` neighbours of `table` are being fetched. */
const isPending = (
  state: GraphState,
  direction: Direction,
  table: string,
): boolean => state.pending.includes(expansionKey(direction, table));

/** What a click on the `direction` expander of `table` does: an open or still pending one collapses, else it expands. */
export const expansionClick = (
  state: GraphState,
  direction: Direction,
  table: string,
): "collapse" | "expand" =>
  isExpanded(state, direction, table) || isPending(state, direction, table)
    ? "collapse"
    : "expand";

/** What a click on `ref` does: the selected column, compared case-insensitively, clears the trace; any other traces. */
export const columnClick = (
  state: GraphState,
  ref: TableColumn,
): "clear" | "trace" => {
  const selected = state.selectedColumn;
  return selected?.[0] === ref[0] &&
    sameColumnName({ name: selected[1] }, ref[1])
    ? "clear"
    : "trace";
};

const neighbourCount = (table: LineageTable, direction: Direction): number =>
  direction === "children" ? table.childCount : table.parentCount;

/** `state.shown` without `key`, so that expansion draws every neighbour. */
export const shownWithout = (
  state: GraphState,
  key: string,
): Record<string, number> =>
  Object.fromEntries(Object.entries(state.shown).filter(([k]) => k !== key));

/**
 * `state` with the whole project's tables and data-flow pairs added. The tables the graph already knows keep their
 * answers; the pairs draw edges between drawn tables, as links do.
 */
export const withProject = (
  state: GraphState,
  tables: LineageTable[],
  edges: [string, string][],
): GraphState => ({
  ...state,
  known: {
    ...Object.fromEntries(tables.map((t) => [t.table, t])),
    ...state.known,
  },
  links: {
    ...state.links,
    ...Object.fromEntries(edges.map(([p, c]) => [`${p}\0${c}`, [p, c]])),
  },
  project: tables.map((t) => t.table),
});

/**
 * The drawn tables and table edges, each edge `[parent, child]`. Every known parent-child pair between drawn
 * tables is an edge, whichever expansion fetched it.
 */
export function drawnGraph(state: GraphState): {
  tables: LineageTable[];
  edges: [string, string][];
} {
  const visible = visibleOf(state);
  return {
    tables: [...visible.drawn].flatMap((id) => state.known[id] ?? []),
    edges: knownPairs(state).filter(
      ([parent, child]) => visible.hasEdges(parent) && visible.hasEdges(child),
    ),
  };
}

/** The IDs of the drawn tables. */
export const drawnIds = (state: GraphState): Set<string> =>
  new Set(drawnGraph(state).tables.map((t) => t.table));

/** `state` with expansions, column lists, edges and selection outside the drawn graph removed. */
export function prune(state: GraphState): GraphState {
  let next = state;
  for (;;) {
    const drawn = drawnIds(next);
    const expansions = next.expansions.filter((key) =>
      drawn.has(parseExpansion(key)?.[1] ?? ""),
    );
    if (expansions.length === next.expansions.length) {
      const columnEdges = next.columnEdges.filter(
        (e) => drawn.has(e.source[0]) && drawn.has(e.target[0]),
      );
      const selectedColumn =
        next.selectedColumn && drawn.has(next.selectedColumn[0])
          ? next.selectedColumn
          : undefined;
      const groups = Object.fromEntries(
        Object.entries(next.groups).filter(([key]) => expansions.includes(key)),
      );
      return {
        ...next,
        groups,
        columnTables: next.columnTables.filter((t) => drawn.has(t)),
        columnEdges: selectedColumn ? columnEdges : [],
        selectedTable:
          next.selectedTable && drawn.has(next.selectedTable)
            ? next.selectedTable
            : undefined,
        selectedColumn,
      };
    }
    next = { ...next, expansions };
  }
}

/**
 * Draws `neighbours` as the `direction` neighbours of `table`.
 * @internal
 */
export function addNeighbours(
  state: GraphState,
  [direction, table]: Expansion,
  neighbours: LineageTable[],
): GraphState {
  const key = expansionKey(direction, table);
  const known = { ...state.known };
  for (const n of neighbours) {
    known[n.table] ??= n;
  }
  const own = known[table];
  // A stale render count can undercount a replayed expansion; its button must still collapse it.
  if (own && neighbourCount(own, direction) < neighbours.length) {
    known[table] = {
      ...own,
      [direction === "children" ? "childCount" : "parentCount"]:
        neighbours.length,
    };
  }
  const expansions = state.expansions.includes(key)
    ? state.expansions
    : [...state.expansions, key];
  const capped = state.cap > 0 && neighbours.length > state.cap;
  const groups =
    capped && state.groupBy === "folder"
      ? bucketNeighbours(neighbours, drawnIds(state), state.cap)
      : undefined;
  const shown = shownWithout(state, key);
  // A capped expansion draws tables already on the canvas first, then the rest by label.
  const drawn = capped ? drawnIds(state) : new Set<string>();
  const ordered = capped
    ? neighbours.toSorted(
        (a, b) =>
          Number(drawn.has(b.table)) - Number(drawn.has(a.table)) ||
          a.label.localeCompare(b.label),
      )
    : neighbours;
  return {
    ...state,
    known,
    expansions,
    neighbours: { ...state.neighbours, [key]: ordered.map((n) => n.table) },
    groups: groups
      ? { ...state.groups, [key]: { ...groups, open: {} } }
      : state.groups,
    shown: capped && !groups ? { ...shown, [key]: state.cap } : shown,
  };
}

/** Removes the `direction` expansion of `table` and whatever was drawn only through it; cancels it if still loading. */
export function collapse(
  state: GraphState,
  direction: Direction,
  table: string,
): GraphState {
  const key = expansionKey(direction, table);
  const shown = shownWithout(state, key);
  return prune({
    ...state,
    shown,
    expansions: state.expansions.filter((k) => k !== key),
    pending: state.pending.filter((k) => k !== key),
    cancelled: { ...state.cancelled, [key]: (state.cancelled[key] ?? 0) + 1 },
  });
}

/**
 * Fetches and draws the `direction` neighbours of `table`, unless its count says it has none. A click goes through
 * here, so a zero count is a no-op for the user.
 */
export async function expand(
  store: GraphStore,
  [direction, table]: Expansion,
  fetch: FetchNeighbours,
): Promise<string[]> {
  const known = store.get().known[table];
  if (!known || neighbourCount(known, direction) === 0) {
    return [];
  }
  return fetchExpansion(store, expansionKey(direction, table), fetch);
}

/**
 * Fetches and draws the `direction` neighbours of `table`, unless they are drawn or already being fetched. It does not
 * consult the table's count: a replayed expansion is recorded whatever the fetch answers, `[]` included. The key is
 * pending until the fetch settles, so a collapse meanwhile drops the answer.
 */
export async function fetchExpansion(
  store: GraphStore,
  key: string,
  fetch: FetchNeighbours,
): Promise<string[]> {
  const parsed = parseExpansion(key);
  if (!parsed) {
    return [];
  }
  const [direction, table] = parsed;
  if (
    isExpanded(store.get(), direction, table) ||
    isPending(store.get(), direction, table)
  ) {
    return [];
  }
  const cancelledBefore = store.get().cancelled[key] ?? 0;
  store.update((s) => ({ ...s, pending: [...s.pending, key] }));
  let neighbours: LineageTable[];
  try {
    neighbours = await fetch(direction, table);
  } finally {
    store.update((s) => ({
      ...s,
      pending: s.pending.filter((k) => k !== key),
    }));
  }
  if ((store.get().cancelled[key] ?? 0) !== cancelledBefore) {
    return [];
  }
  store.update((s) => addNeighbours(s, [direction, table], neighbours));
  return neighbours.map((n) => n.table);
}

/** Records every data-flow edge among the drawn tables, so a diamond's shortcut edge is drawn too. */
export async function linkDrawn(
  store: GraphStore,
  fetch: FetchEdges,
): Promise<void> {
  const { expansions, neighbours } = store.get();
  const drawn = drawnIds(store.get());
  // A closed bucket's members are not drawn, but their links are fetched so they show when it opens.
  const members = expansions
    .filter((key) => drawn.has(parseExpansion(key)?.[1] ?? ""))
    .flatMap((key) => neighbours[key] ?? []);
  const tables = [...new Set([...drawn, ...members])];
  if (tables.length < 2) {
    return;
  }
  const pairs = await fetch(tables);
  store.update((s) => {
    const links = { ...s.links };
    for (const pair of pairs) {
      links[pair.join("\u0000")] = pair;
    }
    return { ...s, links };
  });
}

/** Lists the columns of each of `tables` that is drawn, fetching the ones not cached. */
export async function showColumns(
  store: GraphStore,
  tables: readonly string[],
  fetch: FetchColumns,
): Promise<void> {
  await Promise.all(
    tables.map(async (table) => {
      if (!drawnIds(store.get()).has(table)) {
        return;
      }
      const columns = store.get().columns[table] ?? (await fetch(table));
      store.update((s) => ({
        ...s,
        columns: { ...s.columns, [table]: columns },
        columnTables: s.columnTables.includes(table)
          ? s.columnTables
          : [...s.columnTables, table],
      }));
    }),
  );
}

export const hideColumns = (state: GraphState, table: string): GraphState =>
  prune({
    ...state,
    columnTables: state.columnTables.filter((t) => t !== table),
    ...(state.selectedColumn?.[0] === table
      ? {
          selectedColumn: undefined,
          columnEdges: [],
          errors: {},
          tracing: undefined,
        }
      : {}),
  });

/**
 * `state` with `hidden` as its hidden cards, one per ID (the last label given wins). The expansions stay, so restoring a
 * card draws what it drew again: `visibleOf` leaves the hidden cards and what only they drew out of the view.
 */
export const withHidden = (
  state: GraphState,
  hidden: readonly lineage.HiddenCard[],
): GraphState => ({
  ...state,
  hiddenCards: [...new Map(hidden.map((card) => [card.id, card])).values()],
});

export const selectTable = (
  state: GraphState,
  table: string | undefined,
): GraphState => ({ ...state, selectedTable: table });

/** Clears the column selection, its edges and any trace in flight. */
export const clearColumn = (state: GraphState): GraphState => ({
  ...state,
  selectedColumn: undefined,
  columnEdges: [],
  errors: {},
  tracing: undefined,
});
