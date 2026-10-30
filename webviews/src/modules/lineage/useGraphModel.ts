import type { lineage } from "@fusion-power-user/webview-contract";
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
import { connectionCounts, emphasisOf } from "./emphasis";
import { createLayouter, type Layouter } from "./engine/layoutCache";
import type { LayoutInput } from "./engine/layoutRequest";
import { cappedCounts } from "./expansionCap";
import { collapsedGroups, groupChips } from "./expansionGroups";
import { type BuiltFlow, drawnPairs, emphasize, toFlow } from "./flow";
import { type GraphState, knownPairs, visibleOf } from "./graph";
import { combinedEdges } from "./groupEdges";
import {
  fetchHiddenCards,
  fetchRelationships,
  fetchSettings,
  persistSettings,
} from "./requests";
import type { ExpansionOptions } from "./useLineageGraph";
import { useLineageGraph } from "./useLineageGraph";
import type { ResolvedSettings } from "./viewModel";
import { resolveSettings, visibleRefs } from "./viewModel";
import { lineageData } from "./visibility";

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

/**
 * The hidden cards the host kept for the workspace, with `undefined` until they arrive. A failed read hides nothing.
 */
const useHiddenCards = () => {
  const [hidden, setHidden] = useState<lineage.HiddenCard[]>();
  useEffect(() => {
    fetchHiddenCards().then(setHidden, (error) => {
      panelLogger.error("lineage hidden cards", error);
      setHidden([]);
    });
  }, []);
  return hidden;
};

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
  return { nodeKey, shapeKey: `${settings.engine}|${settings.connections}` };
};

/** The hidden cards by id, each with the label it was hidden with; the id stands in only when no label was stored. */
const hiddenCardsOf = (
  cards: lineage.HiddenCard[],
): { id: string; name: string }[] =>
  cards.map((card) => ({ id: card.id, name: card.label ?? card.id }));

/**
 * The relationships of the Current Project, fetched while declared relationships are drawn and
 * again after each redraw.
 */
const useRefs = (settings: ResolvedSettings, drawnKey: number) => {
  const [refs, setRefs] = useState<lineage.LineageRef[]>([]);
  const declared = settings.connections !== "dbt";
  useEffect(() => {
    if (!declared) {
      return;
    }
    let live = true;
    fetchRelationships(settings.includeSourcesInInference)
      .then((r) => live && setRefs(r))
      .catch((error) => panelLogger.error("lineage relationships", error));
    return () => {
      live = false;
    };
  }, [declared, settings.includeSourcesInInference, drawnKey]);
  return refs;
};

/**
 * The settings a flow is built from: each one that places, labels or filters a card or edge. The emphasis settings are
 * not among them, so changing one restyles the built flow instead of rebuilding it.
 */
type FlowSettings = Pick<
  ResolvedSettings,
  | "showSelectEdges"
  | "showNonSelectEdges"
  | "connections"
  | "engine"
  | "title"
  | "layerColors"
  | "enabledRefSources"
  | "inferenceConfidenceThreshold"
>;

/** The React Flow nodes and edges, with no emphasis, and the drawn pairs the emphasis follows. */
const flowOf = ({
  graph,
  settings,
  refs,
  columnsNeedStrict,
  layouter,
}: {
  graph: GraphState;
  settings: FlowSettings;
  refs: lineage.LineageRef[];
  columnsNeedStrict: boolean;
  layouter: Layouter;
}): { flow: BuiltFlow; pairs: ReturnType<typeof drawnPairs> } => {
  const data = lineageData(graph, {
    direct: settings.showSelectEdges,
    indirect: settings.showNonSelectEdges,
  });
  const drawn = new Set(data.tables.map((t) => t.table));
  const groups = collapsedGroups(graph);
  const layout: LayoutInput = {
    data,
    columns: graph.columns,
    columnTables: graph.columnTables,
    groups,
    groupEdges: combinedEdges(graph, groups),
    chips: groupChips(graph),
    connections: settings.connections,
    refs: visibleRefs(refs, settings, drawn),
    engine: settings.engine,
  };
  const flow = toFlow(
    layout,
    {
      title: settings.title,
      expansions: graph.expansions,
      pending: graph.pending,
      capped: cappedCounts(graph),
      filteredOut: visibleOf(graph).filteredOut,
      errors: graph.errors,
      selectedTable: graph.selectedTable,
      selectedColumn: graph.selectedColumn,
      tracing: graph.tracing,
      columnsNeedStrict,
      layerColors: settings.layerColors,
    },
    layouter,
  );
  return { flow, pairs: drawnPairs(layout) };
};

/**
 * The flow built from the layout settings, with the pairs its emphasis follows. The memo keys on the settings a flow is
 * built from, as primitives, so a hover or an emphasis setting never rebuilds it.
 */
const useBuiltFlow = ({
  graph,
  settings,
  refs,
  columnsNeedStrict,
}: {
  graph: GraphState;
  settings: ResolvedSettings;
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
}: {
  graph: GraphState;
  settings: ResolvedSettings;
  built: ReturnType<typeof useBuiltFlow>;
  hovered: string | undefined;
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
      }),
    [
      built.pairs,
      degrees,
      focus,
      pathHighlight,
      dimOffPath,
      hubDeemphasis,
      maxNeighbours,
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
  drawnKey: number;
  nodes: BuiltFlow["nodes"];
  edges: BuiltFlow["edges"];
  notice: NonNullable<Lineage["rendered"]>["missingLineageMessage"];
  details: GraphState["known"][string] | undefined;
  nodeKey: string;
  shapeKey: string;
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
 * The lineage view's model: the settings, the graph and its React Flow nodes and edges, the notice, and the keys the
 * canvas fits by. The details drawer opens for a table through `openDetails`.
 */
export const useGraphModel = (
  drawerRef: RefObject<DrawerRef | null>,
): GraphModel => {
  const [detailsTable, setDetailsTable] = useState<string>();
  const { settings, loaded, change } = useSettings();
  const hiddenIds = useHiddenCards();
  const openDetails = useCallback(
    (table: string) => {
      setDetailsTable(table);
      drawerRef.current?.open();
    },
    [drawerRef],
  );
  // Read when a rebuild starts, so it follows the latest settings without re-creating the graph store. A layout
  // effect runs before the graph's effects, so a render held until the settings load is drawn with them.
  const expansionRef = useRef(settings.defaultExpansion);
  const optionsRef = useRef<ExpansionOptions>({
    cap: settings.maxNeighbours,
    groupBy: settings.groupBy,
  });
  useLayoutEffect(() => {
    expansionRef.current = settings.defaultExpansion;
    optionsRef.current = {
      cap: settings.maxNeighbours,
      groupBy: settings.groupBy,
    };
  }, [settings.defaultExpansion, settings.maxNeighbours, settings.groupBy]);
  const defaultExpansion = useCallback(() => expansionRef.current, []);
  const expansionOptions = useCallback(() => optionsRef.current, []);
  const {
    graph,
    rendered,
    drawnKey,
    actions,
    select,
    reset,
    restore,
    restoreAll,
  } = useLineageGraph(defaultExpansion, openDetails, {
    expansionOptions,
    ready: loaded && hiddenIds !== undefined,
    hidden: hiddenIds,
  });
  const hiddenCards = useMemo(
    () => hiddenCardsOf(graph.hiddenCards),
    [graph.hiddenCards],
  );
  const notice = rendered?.missingLineageMessage;
  const columnsNeedStrict = rendered?.columnsNeedStrict === true;
  const refs = useRefs(settings, drawnKey);
  const { hovered, hover } = useHoveredCard(settings);
  const built = useBuiltFlow({ graph, settings, refs, columnsNeedStrict });
  const { nodes, edges } = useEmphasizedFlow({
    graph,
    settings,
    built,
    hovered,
  });
  const details = detailsTable ? graph.known[detailsTable] : undefined;
  const { nodeKey, shapeKey } = useFitKeys(built.flow, settings);
  return {
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
    drawnKey,
    nodes,
    edges,
    notice,
    details,
    nodeKey,
    shapeKey,
  };
};
