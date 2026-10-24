import type { lineage } from "@fusion-power-user/webview-contract";
import type { LineageViewState } from "@modules/app/viewState";
import { readViewState, writeViewState } from "@modules/app/viewState";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { traceColumn } from "./columnTrace";
import { expandLevels, replayExpansions } from "./expansionBatch";
import { showMore } from "./expansionCap";
import { closeGroup, openGroup, showMoreInGroup } from "./expansionGroups";
import type { ColumnRef, Direction, GraphState, GraphStore } from "./graph";
import {
  clearColumn,
  collapse,
  columnClick,
  emptyGraph,
  expand,
  expansionClick,
  hideColumns,
  linkDrawn,
  selectTable,
  showColumns,
} from "./graph";
import {
  executeRequestInAsync,
  fetchColumns,
  fetchConnected,
  fetchEdges,
  fetchNeighbours,
  openFile,
} from "./requests";
import type { TableActions } from "./viewModel";
import { planRender, viewStateOf } from "./viewModel";

const logError = (what: string) => (error: unknown) =>
  panelLogger.error(`lineage ${what}`, error);

/** How an expansion draws its neighbours: at most `cap` at first (0 draws all), and bucketed by `groupBy`. */
export interface ExpansionOptions {
  cap: number;
  groupBy: "none" | "folder";
}

/** Replays `saved` onto the start table, or expands `levels` levels when nothing is saved. */
async function build(
  store: GraphStore,
  saved: LineageViewState | undefined,
  levels: number,
): Promise<void> {
  if (!saved) {
    await expandLevels(store, levels, fetchNeighbours);
    await linkDrawn(store, fetchEdges);
    return;
  }
  await replayExpansions(
    store,
    { expansions: saved.expansions, openGroups: saved.openGroups ?? [] },
    fetchNeighbours,
  );
  await linkDrawn(store, fetchEdges);
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
    // A click on an expander that is still loading cancels it, as a click on an open one closes it.
    if (expansionClick(s.get(), direction, table) === "collapse") {
      s.update((g) => collapse(g, direction, table));
      return;
    }
    expand(s, direction, table, fetchNeighbours)
      .then(() => linkDrawn(s, fetchEdges))
      .catch(logError("expand"));
  },
  showMore: (table: string, direction: Direction) => {
    const s = store();
    s.update((g) => showMore(g, direction, table));
    linkDrawn(s, fetchEdges).catch(logError("show more"));
  },
  openGroup: (id: string) => {
    const s = store();
    s.update((g) => openGroup(g, id));
    linkDrawn(s, fetchEdges).catch(logError("open group"));
  },
  showMoreInGroup: (id: string) => {
    const s = store();
    s.update((g) => showMoreInGroup(g, id));
    linkDrawn(s, fetchEdges).catch(logError("show more in group"));
  },
  // Closing only removes tables, so there are no new pairs to fetch.
  closeGroup: (id: string) => {
    store().update((g) => closeGroup(g, id));
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
    const ref: ColumnRef = [table, column];
    if (columnClick(s.get(), ref) === "clear") {
      s.update(clearColumn);
      return;
    }
    traceColumn(s, ref, fetchConnected)
      .then((touched) => showColumns(s, touched, fetchColumns))
      .catch(logError("column trace"));
  },
  openDetails,
  openFile,
});

/** The graph state, a store per rebuild generation, and `rebuild`, which bumps `drawnKey` when it settles. */
function useGraphStore(
  defaultExpansion: () => number,
  expansionOptions: () => ExpansionOptions,
) {
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
      const { cap, groupBy } = expansionOptions();
      graphRef.current = emptyGraph(start, cap, groupBy);
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
    [storeFor, defaultExpansion, expansionOptions],
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
 * `expansionOptions` gives the cap on neighbours an expansion draws at first (0 draws all) and how they are grouped.
 * While `ready` is false, the latest render is held and drawn once it turns true, so the cap is the host's.
 */
export function useLineageGraph(
  defaultExpansion: () => number,
  openDetails: (table: string) => void,
  {
    expansionOptions = () => ({ cap: 0, groupBy: "none" }),
    ready = true,
  }: { expansionOptions?: () => ExpansionOptions; ready?: boolean } = {},
): {
  graph: GraphState;
  /** The latest `render` arguments: the panel notice and whether empty column lists need strict analysis. */
  rendered?: lineage.RenderArgs | undefined;
  drawnKey: number;
  actions: TableActions;
  select: (table: string | undefined) => void;
  reset: () => void;
} {
  const { graph, graphRef, drawnKey, buildingRef, current, rebuild } =
    useGraphStore(defaultExpansion, expansionOptions);
  const [rendered, setRendered] = useState<lineage.RenderArgs>();
  const publicationRef = useRef<string | undefined>(undefined);
  const refreshRef = useRef(false);
  const restoredRef = useRef(false);

  const onRender = useHeldUntil(
    ready,
    useCallback(
      (args: lineage.RenderArgs | undefined) => {
        setRendered(args);
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
    ),
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
  const { select, actions } = useTableActions(current, openDetails);
  return { graph, rendered, drawnKey, actions, select, reset };
}

/** `handle`, except that while `ready` is false the latest call is held, and replayed once `ready` turns true. */
function useHeldUntil<T>(ready: boolean, handle: (value: T) => void) {
  const readyRef = useRef(ready);
  const heldRef = useRef<{ value: T }>(undefined);
  useEffect(() => {
    readyRef.current = ready;
    const held = heldRef.current;
    if (ready && held) {
      heldRef.current = undefined;
      handle(held.value);
    }
  }, [ready, handle]);
  return useCallback(
    (value: T) => {
      if (readyRef.current) {
        handle(value);
      } else {
        heldRef.current = { value };
      }
    },
    [handle],
  );
}

/** Selection and the table actions over the current store; stable while `current` and `openDetails` are. */
function useTableActions(
  current: () => GraphStore,
  openDetails: (table: string) => void,
) {
  const select = useCallback(
    (table: string | undefined) =>
      current().update((s) => selectTable(s, table)),
    [current],
  );
  const actions = useMemo(
    () =>
      actionsFor(current, (table) => {
        select(table);
        openDetails(table);
      }),
    [current, select, openDetails],
  );
  return { select, actions };
}
