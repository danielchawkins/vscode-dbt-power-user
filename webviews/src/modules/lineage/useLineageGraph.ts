import type { lineage } from "@fusion-power-user/webview-contract";
import type { LineageViewState } from "@modules/app/viewState";
import { readViewState } from "@modules/app/viewState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { traceColumn } from "./columnTrace";
import { expandDepths, replayExpansions } from "./expansionBatch";
import type { GraphScope, GraphState, GraphStore, ViewSettings } from "./graph";
import {
  emptyGraph,
  linkDrawn,
  NEIGHBOURHOOD_VIEW,
  selectTable,
  showColumns,
  withProject,
} from "./graph";
import {
  useHeldUntil,
  useHiddenSeed,
  useHostMessages,
  useScopeSeed,
  useViewStateWriter,
  useWholeFrame,
} from "./lineageHooks";
import {
  fetchColumns,
  fetchConnected,
  fetchEdges,
  fetchNeighbours,
  fetchProjectGraph,
} from "./requests";
import { actionsFor, logError, setHidden } from "./tableActions";
import type { TableActions } from "./viewModel";
import { planRender } from "./viewModel";

/** How an expansion draws its neighbours: at most `cap` at first (0 draws all), and bucketed by `groupBy`; and the view. */
export interface ExpansionOptions {
  cap: number;
  groupBy: "none" | "folder";
  view: ViewSettings;
}

/**
 * The view settings that shape the build as one comparable key: a change of the view mode or a depth relays the graph
 * out. The card budget is not among them; it only changes the projection, so it is synced into the state instead.
 */
const shapeKeyOf = (view: ViewSettings): string =>
  [view.viewMode, view.upstreamDepth, view.downstreamDepth].join("|");

/**
 * Draws the view `store` holds. The whole project comes from the host; the neighbourhood replays `saved` and expands
 * to the depths. Saved columns and the selection are restored after either.
 */
async function build(
  store: GraphStore,
  saved: LineageViewState | undefined,
): Promise<void> {
  const { view } = store.get();
  if (view.viewMode === "whole") {
    const { tables, edges } = await fetchProjectGraph();
    store.update((s) => withProject(s, tables, edges));
  } else {
    await replayExpansions(
      store,
      {
        expansions: saved?.expansions ?? [],
        openGroups: saved?.openGroups ?? [],
      },
      fetchNeighbours,
    );
    await expandDepths(
      store,
      { parents: view.upstreamDepth, children: view.downstreamDepth },
      fetchNeighbours,
    );
    await linkDrawn(store, fetchEdges);
  }
  if (!saved) {
    return;
  }
  await showColumns(store, saved.columnTables, fetchColumns);
  store.update((s) => selectTable(s, saved.selectedTable));
  const column = saved.selectedColumn;
  const [table, name] = column ?? [];
  if (table !== undefined && name !== undefined) {
    await traceColumn(store, [table, name], fetchConnected);
  }
}

/** The graph state, a store per rebuild generation, and `rebuild`, which bumps `drawnKey` when it settles. */
function useGraphStore(expansionOptions: () => ExpansionOptions) {
  const [graph, setGraph] = useState<GraphState>(emptyGraph);
  const [drawnKey, setDrawnKey] = useState(0);
  const graphRef = useRef(graph);
  const generationRef = useRef(0);
  const buildingRef = useRef(false);
  // The view the graph was last built for; a different one on the panel is relaid out.
  const builtViewRef = useRef<string | undefined>(undefined);

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
      const { cap, groupBy, view } = expansionOptions();
      // The hidden cards outlive the graph they were hidden in: every start model keeps them.
      graphRef.current = {
        ...emptyGraph(start, cap, groupBy),
        view,
        hiddenCards: graphRef.current.hiddenCards,
        scope: graphRef.current.scope,
      };
      setGraph(graphRef.current);
      builtViewRef.current = shapeKeyOf(view);
      buildingRef.current = !!start;
      if (!start) {
        return;
      }
      build(storeFor(gen), saved)
        .catch(logError("rebuild"))
        .finally(() => {
          if (gen === generationRef.current) {
            buildingRef.current = false;
            setDrawnKey((k) => k + 1);
          }
        });
    },
    [storeFor, expansionOptions],
  );

  const current = useCallback(
    () => storeFor(generationRef.current),
    [storeFor],
  );
  return {
    graph,
    graphRef,
    drawnKey,
    buildingRef,
    builtViewRef,
    current,
    rebuild,
  };
}

/**
 * The lineage graph driven by the host's `render` and `projectSaved` messages. The first render replays the view
 * state VS Code kept for a rebuilt page; every change after it is written back through `writeViewState`.
 * `expansionOptions` gives the cap on neighbours an expansion draws at first (0 draws all) and how they are grouped.
 * While `ready` is false, the latest render is held and drawn once it turns true, so the cap is the host's.
 */
/** The options of `useLineageGraph`. */
interface LineageGraphOptions {
  expansionOptions?: () => ExpansionOptions;
  /** "More" on a neighbourhood card the card budget left out: raises the budget. */
  raiseBudget?: (by: number) => void;
  ready?: boolean;
  /** The hidden cards the host sent for the workspace; undefined until they arrive. */
  hidden?: lineage.HiddenCard[] | undefined;
  /** The Scope filters the host sent for the workspace, or the user changed since; undefined until they arrive. */
  scope?: GraphScope | undefined;
}

/** What `useLineageGraph` returns. */
interface LineageGraphModel {
  graph: GraphState;
  /** The latest `render` arguments: the panel notice and whether empty column lists need strict analysis. */
  rendered?: lineage.RenderArgs | undefined;
  drawnKey: number;
  actions: TableActions;
  select: (table: string | undefined) => void;
  reset: () => void;
  /** The cards the whole view fits to, as IDs; undefined in the neighbourhood, which fits to what it draws. */
  frame: string[] | undefined;
  restore: (table: string) => void;
  restoreAll: () => void;
}

/**
 * A changed view mode or depth relays the graph out from the start card, as Reset does. A changed card budget only
 * projects again: the state keeps the selection, the expansions and the column lists.
 */
function useViewSync(
  {
    graphRef,
    builtViewRef,
    current,
    reset,
  }: {
    graphRef: { current: GraphState };
    builtViewRef: { current: string | undefined };
    current: () => GraphStore;
    reset: () => void;
  },
  expansionOptions: () => ExpansionOptions,
): void {
  useEffect(() => {
    const { view } = expansionOptions();
    if (graphRef.current.start && shapeKeyOf(view) !== builtViewRef.current) {
      reset();
      return;
    }
    if (graphRef.current.view.cardBudget !== view.cardBudget) {
      current().update((s) => ({
        ...s,
        view: { ...s.view, cardBudget: view.cardBudget },
      }));
    }
  });
}

export function useLineageGraph(
  defaultExpansion: () => number,
  openDetails: (table: string) => void,
  {
    expansionOptions = () => ({
      cap: 0,
      groupBy: "none",
      view: NEIGHBOURHOOD_VIEW,
    }),
    raiseBudget,
    ready = true,
    hidden,
    scope,
  }: LineageGraphOptions = {},
): LineageGraphModel {
  const {
    graph,
    graphRef,
    drawnKey,
    buildingRef,
    builtViewRef,
    current,
    rebuild,
  } = useGraphStore(expansionOptions);
  useHiddenSeed(current, hidden);
  useScopeSeed(current, scope);
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

  // The saved manifest may change neighbours and columns, so the next render redraws and replays.
  const onProjectSaved = useCallback(() => {
    refreshRef.current = true;
  }, []);
  useHostMessages(onRender, onProjectSaved);

  useViewStateWriter({
    graph,
    drawnKey,
    buildingRef,
    restoredRef,
    publicationRef,
  });

  const reset = () => {
    const start = graphRef.current.start;
    rebuild(start ? graphRef.current.known[start] : undefined);
  };
  useViewSync({ graphRef, builtViewRef, current, reset }, expansionOptions);
  const frame = useWholeFrame(graph, defaultExpansion);
  const tableActions = useTableActions(current, openDetails, raiseBudget);
  return { graph, rendered, drawnKey, reset, frame, ...tableActions };
}

/** Selection and the table actions over the current store; stable while `current` and `openDetails` are. */
function useTableActions(
  current: () => GraphStore,
  openDetails: (table: string) => void,
  raiseBudget: ((by: number) => void) | undefined,
) {
  const select = useCallback(
    (table: string | undefined) =>
      current().update((s) => selectTable(s, table)),
    [current],
  );
  const actions = useMemo(
    () =>
      actionsFor(
        current,
        (table) => {
          select(table);
          openDetails(table);
        },
        raiseBudget,
      ),
    [current, select, openDetails, raiseBudget],
  );
  const restore = useCallback(
    (table: string) =>
      setHidden(
        current(),
        current()
          .get()
          .hiddenCards.filter((card) => card.id !== table),
      ),
    [current],
  );
  const restoreAll = useCallback(() => setHidden(current(), []), [current]);
  return { select, actions, restore, restoreAll };
}
