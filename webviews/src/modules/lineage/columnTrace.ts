import type { lineage } from "@fusion-power-user/webview-contract";
import type {
  TableColumn,
  FetchConnected,
  GraphState,
  GraphStore,
} from "./graph";
import { clearColumn, drawnIds } from "./graph";

type ColumnLineage = lineage.ColumnLineage;
type Trace = NonNullable<GraphState["tracing"]>;

/** Most `getConnectedColumns` rounds per direction of one trace. */
const MAX_TRACE_HOPS = 10;

export const columnKey = ([table, column]: readonly [string, string]): string =>
  `${table}\u0000${column.toLowerCase()}`;

const sameColumn = (a?: TableColumn, b?: TableColumn) =>
  !!a && !!b && columnKey(a) === columnKey(b);

/**
 * Selects `column` and traces its column lineage through the drawn tables, children then parents, one
 * `getConnectedColumns` round per hop. Returns the tables the traced edges touch. A trace replaced or cancelled
 * meanwhile posts no further hops, and its answers are dropped.
 */
export async function traceColumn(
  store: GraphStore,
  column: TableColumn,
  fetch: FetchConnected,
): Promise<string[]> {
  const run: Trace = { column, since: Date.now() };
  store.update((s) => ({
    ...clearColumn(s),
    selectedColumn: column,
    selectedTable: column[0],
    tracing: run,
  }));
  const touched = new Set<string>();
  for (const upstreamExpansion of [true, false]) {
    const done = await traceDirection(store, fetch, {
      run,
      upstreamExpansion,
      touched,
    });
    if (!done) {
      store.update((s) => settle(s, run));
      return [];
    }
  }
  store.update((s) => settle(s, run));
  return [...touched];
}

/** Ends `run` once it has answered or been stopped; a trace started since is left as it is. */
function settle(state: GraphState, run: Trace): GraphState {
  return state.tracing === run ? { ...state, tracing: undefined } : state;
}

/** The columns at the far end of `edges` not yet in `seen`, which it then records. */
function nextFrontier(
  edges: ColumnLineage[],
  upstreamExpansion: boolean,
  seen: Set<string>,
): TableColumn[] {
  const next: TableColumn[] = [];
  for (const edge of edges) {
    const end = upstreamExpansion ? edge.target : edge.source;
    if (!seen.has(columnKey(end))) {
      seen.add(columnKey(end));
      next.push([end[0], end[1]]);
    }
  }
  return next;
}

/** One direction of `traceColumn`; false when `run` was replaced or stopped meanwhile. `touched` collects tables. */
async function traceDirection(
  store: GraphStore,
  fetch: FetchConnected,
  {
    run,
    upstreamExpansion,
    touched,
  }: { run: Trace; upstreamExpansion: boolean; touched: Set<string> },
): Promise<boolean> {
  const { column } = run;
  const seen = new Set([columnKey(column)]);
  let frontier: TableColumn[] = [column];
  for (let hop = 0; hop < MAX_TRACE_HOPS && frontier.length > 0; hop++) {
    const drawn = drawnIds(store.get());
    const body = await fetch({
      targets: frontier,
      upstreamExpansion,
      trace: columnKey(column),
    });
    if (
      store.get().tracing !== run ||
      !sameColumn(store.get().selectedColumn, column)
    ) {
      return false;
    }
    if (body.cancelled) {
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
