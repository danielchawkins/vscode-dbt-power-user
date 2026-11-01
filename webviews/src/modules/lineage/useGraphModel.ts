import { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import type { DrawerRef } from "@uicore";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flowOf } from "./builtFlow";
import { connectionCounts, emphasisOf } from "./emphasis";
import { createLayouter } from "./engine/layoutCache";
import { type BuiltFlow, emphasize } from "./flow";
import { type GraphState, knownPairs, type ViewSettings } from "./graph";
import { fetchRelationships, fetchSettings, persistSettings } from "./requests";
import { useBusyControls, useGraphScope } from "./useBusyControls";
import { useDetailsDrawer } from "./useDetailsDrawer";
import type { ExpansionOptions } from "./useLineageGraph";
import { useLineageGraph } from "./useLineageGraph";
import {
  hiddenCardsOf,
  type ScopeControls,
  useHiddenCards,
  useStoredScope,
} from "./useStoredFilters";
import { type LayoutControl, useStoredLayout } from "./useStoredLayout";
import type { ResolvedSettings } from "./viewModel";
import { resolveSettings } from "./viewModel";

/** The host's view settings, with `loaded` false until they arrive; a change is applied at once and persisted. */
const useSettings = () => {
  const [settings, setSettings] = useState<ResolvedSettings>(() =>
    resolveSettings(undefined),
  );
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetchSettings()
      .then((s) => setSettings(resolveSettings(s)))
      .catch((error) => panelLogger.error("lineage settings", error))
      .finally(() => setLoaded(true));
  }, []);
  const change = (part: Partial<lineage.LineageSettings>) => {
    setSettings((s) => resolveSettings({ ...s, ...part }));
    persistSettings(part).catch((error) =>
      panelLogger.error("lineage settings", error),
    );
  };
  return { settings, loaded, change };
};

/** The options the expansions are built with, from the settings: the cap, the grouping and the view. */
const expansionOptionsOf = (settings: ResolvedSettings): ExpansionOptions => ({
  cap: settings.maxNeighbours,
  groupBy: settings.groupBy,
  view: viewOf(settings),
});

const viewOf = (settings: ResolvedSettings): ViewSettings => ({
  viewMode: settings.viewMode,
  upstreamDepth: settings.upstreamDepth,
  downstreamDepth: settings.downstreamDepth,
  cardBudget: settings.cardBudget,
});

/** The keys the canvas fits by: the drawn nodes by id, and the engine and Connections, which refit it when they change. */
const useFitKeys = (flow: BuiltFlow, settings: ResolvedSettings) => {
  const nodeKey = useMemo(
    () =>
      flow.nodes
        .filter((node) => node.type !== "band")
        .map((node) => node.id)
        .sort()
        .join("\n"),
    [flow],
  );
  return {
    nodeKey,
    // The default expansion sets the neighbourhood the whole view fits to, so changing it refits.
    shapeKey: `${settings.engine}|${settings.connections}|${settings.defaultExpansion}`,
  };
};

/**
 * The relationships of the Current Project, fetched while declared relationships are drawn and
 * again after each redraw.
 */
const useRefs = (settings: ResolvedSettings, drawnKey: number) => {
  const [refs, setRefs] = useState<lineage.LineageRef[]>([]);
  useEffect(() => {
    if (settings.connections === "dbt") {
      return;
    }
    let live = true;
    fetchRelationships(settings.includeSourcesInInference)
      .then((r) => live && setRefs(r))
      .catch((error) => panelLogger.error("lineage relationships", error));
    return () => {
      live = false;
    };
  }, [settings.connections, settings.includeSourcesInInference, drawnKey]);
  return refs;
};

/**
 * The flow built from the layout settings, with the pairs its emphasis follows. The memo keys on the settings a flow is
 * built from, as primitives, so a hover or an emphasis setting never rebuilds it.
 */
const useBuiltFlow = ({
  graph,
  settings,
  spacing,
  refs,
  columnsNeedStrict,
}: {
  graph: GraphState;
  settings: ResolvedSettings;
  spacing: lineage.SpacingPreset;
  refs: lineage.LineageRef[];
  columnsNeedStrict: boolean;
}) => {
  // One layouter for the panel: its cache and the result on screen seed each layout.
  const [layouter] = useState(() => createLayouter());
  const {
    showSelectEdges,
    showNonSelectEdges,
    connections,
    engine,
    title,
    layerColors,
    enabledRefSources,
    inferenceConfidenceThreshold,
  } = settings;
  return useMemo(
    () =>
      flowOf({
        graph,
        settings: {
          showSelectEdges,
          showNonSelectEdges,
          connections,
          engine,
          title,
          layerColors,
          enabledRefSources,
          inferenceConfidenceThreshold,
          spacing,
        },
        refs,
        columnsNeedStrict,
        layouter,
      }),
    [
      graph,
      refs,
      columnsNeedStrict,
      layouter,
      spacing,
      showSelectEdges,
      showNonSelectEdges,
      connections,
      engine,
      title,
      layerColors,
      enabledRefSources,
      inferenceConfidenceThreshold,
    ],
  );
};

/**
 * The built flow restyled by its emphasis: the path of the hovered card, else the selected one, the dimming, and the
 * hub de-emphasis. The hub counts are the known connections, not the drawn ones. Restyles only; no layout runs.
 */
const useEmphasizedFlow = ({
  graph,
  settings,
  built,
  hovered,
  dimmed,
}: {
  graph: GraphState;
  settings: ResolvedSettings;
  built: ReturnType<typeof useBuiltFlow>;
  hovered: string | undefined;
  dimmed: readonly string[] | undefined;
}) => {
  const degrees = useMemo(() => connectionCounts(knownPairs(graph)), [graph]);
  const focus = hovered ?? graph.selectedTable;
  const { pathHighlight, dimOffPath, hubDeemphasis, maxNeighbours } = settings;
  const view = useMemo(
    () =>
      emphasisOf(built.pairs, degrees, {
        focus,
        pathHighlight,
        dimOffPath,
        hubDeemphasis,
        maxNeighbours,
        dimmed,
      }),
    [
      built.pairs,
      degrees,
      focus,
      pathHighlight,
      dimOffPath,
      hubDeemphasis,
      maxNeighbours,
      dimmed,
    ],
  );
  return useMemo(() => emphasize(built.flow, view), [built.flow, view]);
};

type Lineage = ReturnType<typeof useLineageGraph>;

/** What the lineage view reads from the model: the settings, the flow, the notice, the keys and the callbacks. */
interface GraphModel {
  settings: ResolvedSettings;
  change: (part: Partial<lineage.LineageSettings>) => void;
  reset: Lineage["reset"];
  actions: Lineage["actions"];
  select: Lineage["select"];
  hover: (table: string | undefined) => void;
  openDetails: (table: string) => void;
  /** The hidden cards by id, with the name each is shown by. */
  hiddenCards: { id: string; name: string }[];
  restore: (table: string) => void;
  restoreAll: () => void;
  /** The Scope control: the filters and what they take out. */
  scope: ScopeControls;
  /** The Layout control: the spacing the cards are placed with, and its change. */
  layout: LayoutControl;
  /** The measures of the last layout, for the Layout readout. */
  metrics: BuiltFlow["metrics"];
  drawnKey: number;
  nodes: BuiltFlow["nodes"];
  edges: BuiltFlow["edges"];
  notice: NonNullable<Lineage["rendered"]>["missingLineageMessage"];
  details: GraphState["known"][string] | undefined;
  nodeKey: string;
  shapeKey: string;
  /** The cards the whole view fits to; undefined in the neighbourhood. */
  frame: string[] | undefined;
}

/**
 * The card the pointer is over, which the path highlight follows. It is kept only while a highlight is on, so a hover
 * with the emphasis off rebuilds nothing.
 */
const useHoveredCard = (settings: ResolvedSettings) => {
  const [pointed, setPointed] = useState<string>();
  const hover = useCallback(
    (table: string | undefined) => setPointed(table),
    [],
  );
  const highlighting = settings.pathHighlight || settings.dimOffPath;
  return { hovered: highlighting ? pointed : undefined, hover };
};

/**
 * The graph's reads of the settings, held in refs so a change follows without re-creating the graph store. A layout
 * effect runs before the graph's effects, so a render held until the settings load is drawn with them. "More" in the
 * neighbourhood, when the card budget left the cards out, raises the budget by one expansion's cap.
 */
const useSettingsRefs = (
  settings: ResolvedSettings,
  change: ReturnType<typeof useSettings>["change"],
) => {
  const expansionRef = useRef(settings.defaultExpansion);
  const optionsRef = useRef<ExpansionOptions>(expansionOptionsOf(settings));
  const changeRef = useRef(change);
  useLayoutEffect(() => {
    expansionRef.current = settings.defaultExpansion;
    optionsRef.current = expansionOptionsOf(settings);
    changeRef.current = change;
  }, [settings, change]);
  const defaultExpansion = useCallback(() => expansionRef.current, []);
  const expansionOptions = useCallback(() => optionsRef.current, []);
  const raiseBudget = useCallback((by: number) => {
    const { cardBudget } = optionsRef.current.view;
    const next = cardBudget + Math.max(1, by);
    changeRef.current({ cardBudget: Math.min(lineage.MAX_CARD_BUDGET, next) });
  }, []);
  return { defaultExpansion, expansionOptions, raiseBudget };
};

/**
 * The flow the graph draws: its refs, the built layout, the Scope controls, the emphasised nodes and edges,
 * and the keys the canvas fits by. A hover restyles the built flow; only a change to its inputs lays it out again.
 */
const useDrawnFlow = ({
  graph,
  rendered,
  drawnKey,
  settings,
  layout,
  storedScope,
  actions,
}: {
  graph: GraphState;
  rendered: Lineage["rendered"];
  drawnKey: number;
  settings: ResolvedSettings;
  layout: LayoutControl;
  storedScope: ReturnType<typeof useStoredScope>;
  actions: Lineage["actions"];
}) => {
  const refs = useRefs(settings, drawnKey);
  const { hovered, hover } = useHoveredCard(settings);
  const built = useBuiltFlow({
    graph,
    settings,
    spacing: layout.spacing,
    refs,
    columnsNeedStrict: rendered?.columnsNeedStrict === true,
  });
  const scope = useBusyControls({
    graph,
    threshold: settings.maxNeighbours,
    stored: storedScope,
    hide: actions.hide,
    edgeGroups: built.edgeGroups,
  });
  const { nodes, edges } = useEmphasizedFlow({
    graph,
    settings,
    built,
    hovered,
    dimmed: storedScope.scope?.dimmed,
  });
  const { nodeKey, shapeKey } = useFitKeys(built.flow, settings);
  return {
    scope,
    hover,
    nodes,
    edges,
    nodeKey,
    shapeKey,
    metrics: built.flow.metrics,
  };
};

/**
 * The lineage view's model: the settings, the graph and its React Flow nodes and edges, the notice, and the keys the
 * canvas fits by. The details drawer opens for a table through `openDetails`.
 */
export const useGraphModel = (
  drawerRef: RefObject<DrawerRef | null>,
): GraphModel => {
  const { settings, loaded, change } = useSettings();
  const hiddenIds = useHiddenCards();
  const storedScope = useStoredScope();
  const layout = useStoredLayout();
  const graphScope = useGraphScope(storedScope.scope);
  const { detailsTable, openDetails } = useDetailsDrawer(drawerRef);
  const { defaultExpansion, expansionOptions, raiseBudget } = useSettingsRefs(
    settings,
    change,
  );
  const {
    graph,
    rendered,
    drawnKey,
    actions,
    select,
    reset,
    restore,
    restoreAll,
    frame,
  } = useLineageGraph(defaultExpansion, openDetails, {
    expansionOptions,
    raiseBudget,
    // The first graph waits for the stored Scope and Layout too, so it is drawn with them already applied.
    ready:
      loaded &&
      hiddenIds !== undefined &&
      storedScope.scope !== undefined &&
      layout.loaded,
    hidden: hiddenIds,
    scope: graphScope,
  });
  const hiddenCards = useMemo(
    () => hiddenCardsOf(graph.hiddenCards),
    [graph.hiddenCards],
  );
  const notice = rendered?.missingLineageMessage;
  const { scope, hover, nodes, edges, nodeKey, shapeKey, metrics } =
    useDrawnFlow({
      graph,
      rendered,
      drawnKey,
      settings,
      layout,
      storedScope,
      actions,
    });
  const details = detailsTable ? graph.known[detailsTable] : undefined;
  return {
    frame,
    settings,
    change,
    reset,
    actions,
    select,
    hover,
    openDetails,
    hiddenCards,
    restore,
    restoreAll,
    scope,
    layout,
    metrics,
    drawnKey,
    nodes,
    edges,
    notice,
    details,
    nodeKey,
    shapeKey,
  };
};
