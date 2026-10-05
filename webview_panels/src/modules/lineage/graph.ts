import dagre from "@dagrejs/dagre";
import type { lineage } from "@fusion-power-user/webview-contract";

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
  start?: string;
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
  selectedTable?: string;
  selectedColumn?: ColumnRef;
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

/** Most `getConnectedColumns` rounds per direction of one trace. */
const MAX_TRACE_HOPS = 10;

export const emptyGraph = (start?: LineageTable): GraphState => ({
  start: start?.table,
  known: start ? { [start.table]: start } : {},
  neighbours: {},
  expansions: [],
  columns: {},
  columnTables: [],
  columnEdges: [],
  errors: {},
});

const expansionKey = (direction: Direction, table: string): string =>
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

const neighbourCount = (
  table: LineageTable,
  direction: Direction,
): number => (direction === "children" ? table.childCount : table.parentCount);

/**
 * The drawn tables and table edges, each edge `[parent, child]`.
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
  const edges = new Map<string, [string, string]>();
  for (const key of state.expansions) {
    const parsed = parseExpansion(key);
    if (!parsed || !drawn.has(parsed[1])) {
      continue;
    }
    const [direction, table] = parsed;
    for (const other of state.neighbours[key] ?? []) {
      drawn.add(other);
      const edge: [string, string] =
        direction === "children" ? [table, other] : [other, table];
      edges.set(edge.join("\u0000"), edge);
    }
  }
  return {
    tables: [...drawn].flatMap((id) => state.known[id] ?? []),
    edges: [...edges.values()],
  };
}

const drawnIds = (state: GraphState): Set<string> =>
  new Set(drawnGraph(state).tables.map((t) => t.table));

/** `state` with expansions, column lists, edges and selection outside the drawn graph removed. */
function prune(state: GraphState): GraphState {
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
      return {
        ...next,
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
  return {
    ...state,
    known,
    neighbours: { ...state.neighbours, [key]: neighbours.map((n) => n.table) },
    expansions: state.expansions.includes(key)
      ? state.expansions
      : [...state.expansions, key],
  };
}

/** Removes the `direction` expansion of `table` and whatever was drawn only through it. */
export function collapse(
  state: GraphState,
  direction: Direction,
  table: string,
): GraphState {
  const key = expansionKey(direction, table);
  return prune({
    ...state,
    expansions: state.expansions.filter((k) => k !== key),
  });
}

/** Fetches and draws the `direction` neighbours of `table`, unless it has none or they are drawn. */
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
    isExpanded(store.get(), direction, table)
  ) {
    return [];
  }
  const neighbours = await fetch(direction, table);
  store.update((s) => addNeighbours(s, direction, table, neighbours));
  return neighbours.map((n) => n.table);
}

/** Expands the start table `levels` levels of parents and of children. */
export async function expandLevels(
  store: GraphStore,
  levels: number,
  fetch: FetchNeighbours,
): Promise<void> {
  const start = store.get().start;
  if (!start) {
    return;
  }
  for (const direction of ["parents", "children"] as const) {
    let frontier = [start];
    for (let level = 0; level < levels && frontier.length > 0; level++) {
      const added = await Promise.all(
        frontier.map((table) => expand(store, direction, table, fetch)),
      );
      frontier = [...new Set(added.flat())];
    }
  }
}

/** Applies saved expansion keys in order; a key whose table is not drawn by then is skipped. */
export async function replayExpansions(
  store: GraphStore,
  keys: readonly string[],
  fetch: FetchNeighbours,
): Promise<void> {
  for (const key of keys) {
    const parsed = parseExpansion(key);
    if (parsed && drawnIds(store.get()).has(parsed[1])) {
      await expand(store, parsed[0], parsed[1], fetch);
    }
  }
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

const columnKey = ([table, column]: readonly [string, string]) =>
  `${table}\u0000${column.toLowerCase()}`;

const sameColumn = (a?: ColumnRef, b?: ColumnRef) =>
  !!a && !!b && columnKey(a) === columnKey(b);

/** Clears the column selection and its edges. */
export const clearColumn = (state: GraphState): GraphState => ({
  ...state,
  selectedColumn: undefined,
  columnEdges: [],
  errors: {},
});

/**
 * Selects `column` and traces its column lineage through the drawn tables, children then parents, one
 * `getConnectedColumns` round per hop. Returns the tables the traced edges touch. Answers arriving after another
 * column was selected are dropped.
 */
export async function traceColumn(
  store: GraphStore,
  column: ColumnRef,
  fetch: FetchConnected,
): Promise<string[]> {
  store.update((s) => ({
    ...clearColumn(s),
    selectedColumn: column,
    selectedTable: column[0],
  }));
  const touched = new Set<string>();
  for (const upstreamExpansion of [true, false]) {
    const done = await traceDirection(
      store,
      column,
      upstreamExpansion,
      fetch,
      touched,
    );
    if (!done) {
      return [];
    }
  }
  return [...touched];
}

/** The columns at the far end of `edges` not yet in `seen`, which it then records. */
function nextFrontier(
  edges: ColumnLineage[],
  upstreamExpansion: boolean,
  seen: Set<string>,
): ColumnRef[] {
  const next: ColumnRef[] = [];
  for (const edge of edges) {
    const end = upstreamExpansion ? edge.target : edge.source;
    if (!seen.has(columnKey(end))) {
      seen.add(columnKey(end));
      next.push([end[0], end[1]]);
    }
  }
  return next;
}

/** One direction of `traceColumn`; false when another column was selected meanwhile. */
async function traceDirection(
  store: GraphStore,
  column: ColumnRef,
  upstreamExpansion: boolean,
  fetch: FetchConnected,
  touched: Set<string>,
): Promise<boolean> {
  const seen = new Set([columnKey(column)]);
  let frontier: ColumnRef[] = [column];
  for (let hop = 0; hop < MAX_TRACE_HOPS && frontier.length > 0; hop++) {
    const drawn = drawnIds(store.get());
    const body = await fetch({
      targets: frontier,
      upstreamExpansion,
      currAnd1HopTables: [...drawn],
      selectedColumn: { table: column[0], name: column[1] },
    });
    if (!sameColumn(store.get().selectedColumn, column)) {
      return false;
    }
    const edges = body.column_lineage.filter(
      (e) => drawn.has(e.source[0]) && drawn.has(e.target[0]),
    );
    store.update((s) => mergeTrace(s, edges, body.errors));
    edges.forEach((e) => touched.add(e.source[0]).add(e.target[0]));
    frontier = nextFrontier(edges, upstreamExpansion, seen);
  }
  return true;
}

function mergeTrace(
  state: GraphState,
  edges: ColumnLineage[],
  errors: Record<string, string[]> | undefined,
): GraphState {
  const byKey = new Map(
    state.columnEdges.map((e) => [
      `${columnKey(e.source)}\u0000${columnKey(e.target)}`,
      e,
    ]),
  );
  for (const e of edges) {
    byKey.set(`${columnKey(e.source)}\u0000${columnKey(e.target)}`, e);
  }
  const merged = { ...state.errors };
  for (const [table, lines] of Object.entries(errors ?? {})) {
    merged[table] = [...new Set([...(merged[table] ?? []), ...lines])];
  }
  return { ...state, columnEdges: [...byKey.values()], errors: merged };
}

/** The data the renderer draws, with column edges filtered by the edge settings. */
export function lineageData(
  state: GraphState,
  show: { direct: boolean; indirect: boolean },
): lineage.LineageData {
  const { tables, edges } = drawnGraph(state);
  return {
    start: state.start,
    tables,
    edges,
    columnEdges: state.columnEdges.filter((e) =>
      e.type === "indirect" ? show.indirect : show.direct,
    ),
  };
}

/** Node geometry the layout and the stylesheet share, in pixels. */
export const geometry = {
  tableWidth: 280,
  headerHeight: 56,
  actionsHeight: 28,
  columnHeight: 24,
  listPadding: 8,
  rankGap: 160,
  nodeGap: 40,
};

/** The height of a table node, listing `columns` when given; an empty list keeps one row for its message. */
export const tableHeight = (columns?: readonly unknown[]): number =>
  geometry.headerHeight +
  geometry.actionsHeight +
  (columns
    ? geometry.listPadding + Math.max(columns.length, 1) * geometry.columnHeight
    : 0);

/** Top-left corner of each table, laid out left to right from parents to children by dagre. */
export function layout(
  tables: readonly LineageTable[],
  edges: readonly [string, string][],
  heightOf: (table: string) => number,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: geometry.rankGap,
    nodesep: geometry.nodeGap,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) {
    g.setNode(t.table, {
      width: geometry.tableWidth,
      height: heightOf(t.table),
    });
  }
  for (const [parent, child] of edges) {
    g.setEdge(parent, child);
  }
  dagre.layout(g);
  // dagre positions node centres.
  return new Map(
    tables.map((t) => {
      const n = g.node(t.table) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return [t.table, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];
    }),
  );
}

/** The handle ID of `column` on the given side of its table node; names match case-insensitively. */
export const columnHandle = (side: "in" | "out", column: string): string =>
  `${side}:${column.toLowerCase()}`;
