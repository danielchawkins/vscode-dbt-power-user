import type { lineage, PanelNotice } from "@fusion-power-user/webview-contract";
import {
  LineageViewState,
  readViewState,
  writeViewState,
} from "@modules/app/viewState";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearColumn,
  collapse,
  ColumnRef,
  Direction,
  emptyGraph,
  expand,
  expandLevels,
  GraphState,
  GraphStore,
  hideColumns,
  isExpanded,
  replayExpansions,
  selectTable,
  showColumns,
  traceColumn,
} from "./graph";
import {
  executeRequestInAsync,
  fetchColumns,
  fetchConnected,
  fetchNeighbours,
  openFile,
} from "./requests";
import { planRender, TableActions, viewStateOf } from "./viewModel";

const logError = (what: string) => (error: unknown) =>
  panelLogger.error(`lineage ${what}`, error);

/** Replays `saved` onto the start table, or expands `levels` levels when nothing is saved. */
async function build(
  store: GraphStore,
  saved: LineageViewState | undefined,
  levels: number,
): Promise<void> {
  if (!saved) {
    await expandLevels(store, levels, fetchNeighbours);
    return;
  }
  await replayExpansions(store, saved.expansions, fetchNeighbours);
  await showColumns(store, saved.columnTables, fetchColumns);
  store.update((s) => selectTable(s, saved.selectedTable));
  const column = saved.selectedColumn;
  const [table, name] = column ?? [];
  if (table !== undefined && name !== undefined) {
    await traceColumn(store, [table, name], fetchConnected);
  }
}

/** The table actions over `store`. */
const actionsFor = (
  store: () => GraphStore,
  openDetails: (table: string) => void,
): TableActions => ({
  toggleExpansion: (table: string, direction: Direction) => {
    const s = store();
    if (isExpanded(s.get(), direction, table)) {
      s.update((g) => collapse(g, direction, table));
      return;
    }
    expand(s, direction, table, fetchNeighbours).catch(logError("expand"));
  },
  toggleColumns: (table: string) => {
    const s = store();
    if (s.get().columnTables.includes(table)) {
      s.update((g) => hideColumns(g, table));
      return;
    }
    showColumns(s, [table], fetchColumns).catch(logError("columns"));
  },
  selectColumn: (table: string, column: string) => {
    const s = store();
    const selected = s.get().selectedColumn;
    if (
      selected?.[0] === table &&
      selected[1].toLowerCase() === column.toLowerCase()
    ) {
      s.update(clearColumn);
      return;
    }
    const ref: ColumnRef = [table, column];
    traceColumn(s, ref, fetchConnected)
      .then((touched) => showColumns(s, touched, fetchColumns))
      .catch(logError("column trace"));
  },
  openDetails,
  openFile,
});

/** The graph state, a store per rebuild generation, and `rebuild`, which bumps `drawnKey` when it settles. */
function useGraphStore(defaultExpansion: () => number) {
  const [graph, setGraph] = useState<GraphState>(emptyGraph);
  const [drawnKey, setDrawnKey] = useState(0);
  const graphRef = useRef(graph);
  const generationRef = useRef(0);
  const buildingRef = useRef(false);

  const storeFor = useCallback(
    (gen: number): GraphStore => ({
      get: () => graphRef.current,
      update: (change) => {
        if (gen !== generationRef.current) {
          return;
        }
        graphRef.current = change(graphRef.current);
        setGraph(graphRef.current);
      },
    }),
    [],
  );

  const rebuild = useCallback(
    (start: lineage.LineageTable | undefined, saved?: LineageViewState) => {
      const gen = ++generationRef.current;
      graphRef.current = emptyGraph(start);
      setGraph(graphRef.current);
      buildingRef.current = !!start;
      if (!start) {
        return;
      }
      build(storeFor(gen), saved, defaultExpansion())
        .catch(logError("rebuild"))
        .finally(() => {
          if (gen === generationRef.current) {
            buildingRef.current = false;
            setDrawnKey((k) => k + 1);
          }
        });
    },
    [storeFor, defaultExpansion],
  );

  const current = useCallback(
    () => storeFor(generationRef.current),
    [storeFor],
  );
  return { graph, graphRef, drawnKey, buildingRef, current, rebuild };
}

/**
 * The lineage graph driven by the host's `render` and `projectSaved` messages. The first render replays the view
 * state VS Code kept for a rebuilt page; every change after it is written back through `writeViewState`.
 */
export function useLineageGraph(
  defaultExpansion: () => number,
  openDetails: (table: string) => void,
): {
  graph: GraphState;
  notice?: PanelNotice | undefined;
  drawnKey: number;
  actions: TableActions;
  select: (table: string | undefined) => void;
  reset: () => void;
} {
  const { graph, graphRef, drawnKey, buildingRef, current, rebuild } =
    useGraphStore(defaultExpansion);
  const [notice, setNotice] = useState<PanelNotice>();
  const publicationRef = useRef<string>();
  const refreshRef = useRef(false);
  const restoredRef = useRef(false);

  const onRender = useCallback(
    (args: lineage.RenderArgs | undefined) => {
      setNotice(args?.missingLineageMessage);
      const plan = planRender({
        args,
        graph: graphRef.current,
        publication: publicationRef.current,
        refresh: refreshRef.current,
        stored: () =>
          restoredRef.current ? undefined : readViewState("lineage"),
      });
      if (!plan) {
        return;
      }
      restoredRef.current = true;
      refreshRef.current = false;
      publicationRef.current = args?.publication;
      rebuild(plan.start, plan.saved);
    },
    [graphRef, rebuild],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<lineage.HostMessage>) => {
      const message = event.data;
      if (message.command === "render") {
        onRender(message.args);
      }
      if (message.command === "projectSaved") {
        // The saved manifest may change neighbours and columns, so the next render redraws and replays.
        refreshRef.current = true;
        executeRequestInAsync("init");
      }
    };
    window.addEventListener("message", onMessage);
    executeRequestInAsync("init");
    return () => window.removeEventListener("message", onMessage);
  }, [onRender]);

  useEffect(() => {
    // A rebuild's partial graph is not written; drawnKey advances when it settles.
    const state =
      restoredRef.current && !buildingRef.current
        ? viewStateOf(graph, publicationRef.current)
        : undefined;
    if (state) {
      writeViewState(state);
    }
  }, [graph, drawnKey, buildingRef]);

  const reset = () => {
    const start = graphRef.current.start;
    rebuild(start ? graphRef.current.known[start] : undefined);
  };
  const select = (table: string | undefined) =>
    current().update((s) => selectTable(s, table));
  const actions = actionsFor(current, (table) => {
    select(table);
    openDetails(table);
  });
  return { graph, notice, drawnKey, actions, select, reset };
}
