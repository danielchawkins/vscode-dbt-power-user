import type { lineage } from "@fusion-power-user/webview-contract";
import type { NeighbourGroups } from "./grouping";
import { bucketNeighbours, groupedNeighbours } from "./grouping";
import { hiddenTables } from "./hiddenNodes";

type LineageTable = lineage.LineageTable;
type LineageColumn = lineage.LineageColumn;
type ColumnLineage = lineage.ColumnLineage;

/** Which neighbours of a table an expansion adds: its dbt children or its dbt parents. */
export type Direction = "children" | "parents";

/** A column as `[table unique ID, column name]`. */
export type ColumnRef = [table: string, column: string];

/**
 * The lineage graph the panel draws. `known`, `neighbours` and `columns` cache host answers; the drawn graph is the
 * start table plus each entry of `expansions`, in order, whose table is drawn.
 */
export interface GraphState {
  start?: string | undefined;
  known: Record<string, LineageTable>;
  /** The neighbour IDs each expansion key added. */
  neighbours: Record<string, string[]>;
  /** Applied expansions, each `c:<table>` (children) or `p:<table>` (parents). */
  expansions: string[];
  columns: Record<string, LineageColumn[]>;
  /** Drawn tables that list their columns. */
  columnTables: string[];
  /** Column edges traced from `selectedColumn`. */
  columnEdges: ColumnLineage[];
  /** Tooltip lines per table from the last trace. */
  errors: Record<string, string[]>;
  /** Collapse count per expansion key; an expansion whose count changed while fetching is dropped. */
  cancelled: Record<string, number>;
  /** Expansion keys whose neighbours are being fetched. */
  pending: string[];
  /**
   * Data-flow `[parent, child]` pairs the host reported among drawn tables, keyed `parent\0child`. They draw edges
   * between tables that are already drawn and never make a table drawn, so collapsing still removes what only an
   * expansion added.
   */
  links: Record<string, [string, string]>;
  /** How many of an expansion's neighbours are drawn, by key; a key without an entry draws them all. */
  shown: Record<string, number>;
  /** The most neighbours a new expansion draws at first; 0 draws all. */
  cap: number;
  /** How neighbours are bucketed once they outnumber `cap`. */
  groupBy: "none" | "folder";
  /** The buckets of each grouped expansion, by key; a grouped key has no `shown` entry. */
  groups: Record<string, NeighbourGroups>;
  selectedTable?: string | undefined;
  selectedColumn?: ColumnRef | undefined;
}

/** Reads and changes the latest graph; an async step reads after each answer, so it never applies a stale base. */
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

export const emptyGraph = (
  start?: LineageTable,
  cap = 0,
  groupBy: "none" | "folder" = "none",
): GraphState => ({
  start: start?.table,
  known: start ? { [start.table]: start } : {},
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
});

export const expansionKey = (direction: Direction, table: string): string =>
  `${direction === "children" ? "c" : "p"}:${table}`;

/** @internal */
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

/** Whether the `direction` neighbours of `table` are being fetched. */
export const isPending = (
  state: GraphState,
  direction: Direction,
  table: string,
): boolean => state.pending.includes(expansionKey(direction, table));

const neighbourCount = (table: LineageTable, direction: Direction): number =>
  direction === "children" ? table.childCount : table.parentCount;

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

/** `state.shown` without `key`, so that expansion draws every neighbour. */
export const shownWithout = (
  state: GraphState,
  key: string,
): Record<string, number> =>
  Object.fromEntries(Object.entries(state.shown).filter(([k]) => k !== key));

/**
 * The drawn tables and table edges, each edge `[parent, child]`. Every known parent-child pair between drawn
 * tables is an edge, whichever expansion fetched it.
 * @internal
 */
export function drawnGraph(state: GraphState): {
  tables: LineageTable[];
  edges: [string, string][];
} {
  if (!state.start || !state.known[state.start]) {
    return { tables: [], edges: [] };
  }
  const drawn = new Set([state.start]);
  for (const key of state.expansions) {
    const table = parseExpansion(key)?.[1];
    if (table && drawn.has(table)) {
      drawnNeighbours(state, key).forEach((other) => drawn.add(other));
    }
  }
  return {
    tables: [...drawn].flatMap((id) => state.known[id] ?? []),
    edges: edgesAmong(state, drawn),
  };
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

/** Every known `[parent, child]` pair with both ends drawn and neither hidden. */
function edgesAmong(
  state: GraphState,
  drawn: ReadonlySet<string>,
): [string, string][] {
  const hidden = hiddenTables(state);
  const edgeable = (id: string) => drawn.has(id) && !hidden.has(id);
  return knownPairs(state).filter(
    ([parent, child]) => edgeable(parent) && edgeable(child),
  );
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
  direction: Direction,
  table: string,
  neighbours: LineageTable[],
): GraphState {
  const key = expansionKey(direction, table);
  const known = { ...state.known };
  for (const n of neighbours) {
    known[n.table] ??= n;
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
 * Fetches and draws the `direction` neighbours of `table`, unless it has none, they are drawn, or they are already
 * being fetched. The key is pending until the fetch settles, so a collapse meanwhile drops the answer.
 */
export async function expand(
  store: GraphStore,
  direction: Direction,
  table: string,
  fetch: FetchNeighbours,
): Promise<string[]> {
  const known = store.get().known[table];
  if (
    !known ||
    neighbourCount(known, direction) === 0 ||
    isExpanded(store.get(), direction, table) ||
    isPending(store.get(), direction, table)
  ) {
    return [];
  }
  const key = expansionKey(direction, table);
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
  store.update((s) => addNeighbours(s, direction, table, neighbours));
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
      ? { selectedColumn: undefined, columnEdges: [], errors: {} }
      : {}),
  });

export const selectTable = (
  state: GraphState,
  table: string | undefined,
): GraphState => ({ ...state, selectedTable: table });

/** Clears the column selection and its edges. */
export const clearColumn = (state: GraphState): GraphState => ({
  ...state,
  selectedColumn: undefined,
  columnEdges: [],
  errors: {},
});

/** The data the renderer draws, with column edges filtered by the edge settings. */
export function lineageData(
  state: GraphState,
  show: { direct: boolean; indirect: boolean },
): lineage.LineageData {
  const { tables, edges } = drawnGraph(state);
  const hidden = hiddenTables(state);
  return {
    start: state.start,
    tables,
    edges,
    columnEdges: state.columnEdges.filter(
      (e) =>
        !hidden.has(e.source[0]) &&
        !hidden.has(e.target[0]) &&
        (e.type === "indirect" ? show.indirect : show.direct),
    ),
  };
}
