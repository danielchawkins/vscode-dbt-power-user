import type { lineage } from "@fusion-power-user/webview-contract";
import type {
  ColumnRef,
  FetchConnected,
  GraphState,
  GraphStore,
} from "./graph";
import { clearColumn, drawnIds } from "./graph";

type ColumnLineage = lineage.ColumnLineage;

/** Most `getConnectedColumns` rounds per direction of one trace. */
const MAX_TRACE_HOPS = 10;

const columnKey = ([table, column]: readonly [string, string]) =>
  `${table}\u0000${column.toLowerCase()}`;

const sameColumn = (a?: ColumnRef, b?: ColumnRef) =>
  !!a && !!b && columnKey(a) === columnKey(b);

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
    const done = await traceDirection(store, fetch, {
      column,
      upstreamExpansion,
      touched,
    });
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

/** One direction of `traceColumn`; false when another column was selected meanwhile. `touched` collects tables. */
async function traceDirection(
  store: GraphStore,
  fetch: FetchConnected,
  {
    column,
    upstreamExpansion,
    touched,
  }: { column: ColumnRef; upstreamExpansion: boolean; touched: Set<string> },
): Promise<boolean> {
  const seen = new Set([columnKey(column)]);
  let frontier: ColumnRef[] = [column];
  for (let hop = 0; hop < MAX_TRACE_HOPS && frontier.length > 0; hop++) {
    const drawn = drawnIds(store.get());
    const body = await fetch({
      targets: frontier,
      upstreamExpansion,
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
