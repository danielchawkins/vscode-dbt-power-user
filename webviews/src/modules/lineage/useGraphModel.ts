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
import { cappedCounts } from "./expansionCap";
import { collapsedGroups, groupChips } from "./expansionGroups";
import { toFlow } from "./flow";
import type { GraphState } from "./graph";
import { visibleOf } from "./graph";
import { combinedEdges } from "./groupEdges";
import { fetchRelationships, fetchSettings, persistSettings } from "./requests";
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

/** The React Flow nodes and edges: the lineage data the settings select, with the relationships drawn. */
const flowOf = ({
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
  const data = lineageData(graph, {
    direct: settings.showSelectEdges,
    indirect: settings.showNonSelectEdges,
  });
  const drawn = new Set(data.tables.map((t) => t.table));
  const groups = collapsedGroups(graph);
  return toFlow(
    {
      data,
      columns: graph.columns,
      columnTables: graph.columnTables,
      groups,
      groupEdges: combinedEdges(graph, groups),
      chips: groupChips(graph),
      connections: settings.connections,
      refs: visibleRefs(refs, settings, drawn),
      engine: settings.engine,
    },
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
  );
};

type Lineage = ReturnType<typeof useLineageGraph>;

/** What the lineage view reads from the model: the settings, the flow, the notice, the keys and the callbacks. */
interface GraphModel {
  settings: ResolvedSettings;
  change: (part: Partial<lineage.LineageSettings>) => void;
  reset: Lineage["reset"];
  actions: Lineage["actions"];
  select: Lineage["select"];
  openDetails: (table: string) => void;
  drawnKey: number;
  nodes: ReturnType<typeof flowOf>["nodes"];
  edges: ReturnType<typeof flowOf>["edges"];
  notice: NonNullable<Lineage["rendered"]>["missingLineageMessage"];
  details: GraphState["known"][string] | undefined;
  nodeKey: string;
  shapeKey: string;
}

/**
 * The lineage view's model: the settings, the graph and its React Flow nodes and edges, the notice, and the keys the
 * canvas fits by. The details drawer opens for a table through `openDetails`.
 */
export const useGraphModel = (
  drawerRef: RefObject<DrawerRef | null>,
): GraphModel => {
  const [detailsTable, setDetailsTable] = useState<string>();
  const { settings, loaded, change } = useSettings();
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
  const { graph, rendered, drawnKey, actions, select, reset } = useLineageGraph(
    defaultExpansion,
    openDetails,
    { expansionOptions, ready: loaded },
  );
  const notice = rendered?.missingLineageMessage;
  const columnsNeedStrict = rendered?.columnsNeedStrict === true;
  const refs = useRefs(settings, drawnKey);
  const { nodes, edges } = useMemo(
    () => flowOf({ graph, settings, refs, columnsNeedStrict }),
    [graph, settings, refs, columnsNeedStrict],
  );
  const details = detailsTable ? graph.known[detailsTable] : undefined;
  // The drawn nodes by id, and the engine and Connections: the fit refits when either changes.
  const nodeKey = useMemo(
    () =>
      nodes
        .filter((node) => node.type !== "band")
        .map((node) => node.id)
        .sort()
        .join("\n"),
    [nodes],
  );
  const shapeKey = `${settings.engine}|${settings.connections}`;
  return {
    settings,
    change,
    reset,
    actions,
    select,
    openDetails,
    drawnKey,
    nodes,
    edges,
    notice,
    details,
    nodeKey,
    shapeKey,
  };
};
