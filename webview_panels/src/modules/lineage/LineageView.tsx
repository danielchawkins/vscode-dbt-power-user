import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import type { DrawerRef } from "@uicore";
import { Drawer } from "@uicore";
import type { FitViewOptions } from "@xyflow/react";
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { hiddenCounts } from "./expansionCap";
import { collapsedGroups, groupChips } from "./expansionGroups";
import { toFlow } from "./flow";
import { lineageData } from "./graph";
import { combinedEdges } from "./groupEdges";
import { GroupNode } from "./GroupNode";
import styles from "./lineageGraph.module.css";
import MissingLineageMessage from "./MissingLineageMessage";
import { fetchRelationships, fetchSettings, persistSettings } from "./requests";
import { isZoomedOut, SemanticZoomContext } from "./semanticZoom";
import TableDetails from "./TableDetails";
import { TableNode } from "./TableNode";
import Toolbar from "./Toolbar";
import { useHandleMeasurement } from "./useHandleMeasurement";
import type { ExpansionOptions } from "./useLineageGraph";
import { useLineageGraph } from "./useLineageGraph";
import type { ResolvedSettings } from "./viewModel";
import { resolveSettings, TableActionsContext, visibleRefs } from "./viewModel";

const nodeTypes = { table: TableNode, group: GroupNode };

/** Fit options whose pixel padding keeps the graph clear of the controls, the legend and the minimap when shown. */
const fitOptions = (minimap?: {
  width: number;
  height: number;
}): FitViewOptions => ({
  maxZoom: 1,
  padding: {
    top: "16px",
    right: `${(minimap?.width ?? 0) + 16}px`,
    bottom: `${Math.max(40, (minimap?.height ?? 0) + 16)}px`,
    left: "56px",
  },
});

/** Logs React Flow's warnings to the webview devtools console. */
const onError = (code: string, message: string) => {
  panelLogger.warn(`[React Flow] ${code}: ${message}`);
};

/**
 * Selects the table a click lands on, and opens its Details while zoomed out hides the card's own button. A group
 * card has no table to select.
 */
const useNodeClick = (
  select: (table: string | undefined) => void,
  openDetails: (table: string) => void,
) => {
  const enabled = use(SemanticZoomContext);
  const store = useStoreApi();
  return (_event: unknown, node: { id: string; type?: string }) => {
    if (node.type === "table") {
      select(node.id);
      if (isZoomedOut(store.getState().transform[2], enabled)) {
        openDetails(node.id);
      }
    }
  };
};

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

/** The relationships of the Current Project, fetched while the overlay is on and again after each redraw. */
const useRefs = (settings: ResolvedSettings, drawnKey: number) => {
  const [refs, setRefs] = useState<lineage.LineageRef[]>([]);
  useEffect(() => {
    if (!settings.showRefs) {
      return;
    }
    let live = true;
    fetchRelationships(settings.includeSourcesInInference)
      .then((r) => live && setRefs(r))
      .catch((error) => panelLogger.error("lineage relationships", error));
    return () => {
      live = false;
    };
  }, [settings.showRefs, settings.includeSourcesInInference, drawnKey]);
  return refs;
};

const Legend = () => (
  <div className={styles.legend}>
    <span>
      <span className={styles.swatch} />
      Select
    </span>
    <span>
      <span className={`${styles.swatch} ${styles.indirect}`} />
      Non-select
    </span>
    <span>
      <span className={`${styles.swatch} ${styles.ref}`} />
      Relationship
    </span>
  </div>
);

/** Below this canvas size the minimap starts hidden; it would cover most of the graph. */
const MINIMAP_MIN = { width: 720, height: 360 };

/** The canvas size, tracked with a `ResizeObserver`. */
const useSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(
      ([entry]) =>
        entry &&
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
};

/** The minimap's visibility: the user's choice once made, otherwise whether the canvas has room for it. */
const useMinimap = (size: { width: number; height: number }) => {
  const [choice, setChoice] = useState<boolean>();
  const roomy =
    size.width >= MINIMAP_MIN.width && size.height >= MINIMAP_MIN.height;
  const shown = (choice ?? roomy) && size.width > 0;
  return { shown, toggle: () => setChoice(!shown) };
};

/** Minimap dimensions: a fifth of the canvas, kept between 120x80 and 200x150. */
const minimapStyle = (size: { width: number; height: number }) => ({
  width: Math.round(Math.min(200, Math.max(120, size.width / 5))),
  height: Math.round(Math.min(150, Math.max(80, size.height / 5))),
});

/**
 * The fit options for the canvas `size`, applied again when the panel is resized, so a shrunk panel still shows the
 * whole graph, and when a new graph is drawn.
 */
const useFit = (
  size: { width: number; height: number },
  minimapShown: boolean,
  drawnKey: number,
): FitViewOptions => {
  const flow = useReactFlow();
  const { width, height } = size;
  const mapWidth = minimapStyle(size).width;
  const mapHeight = minimapStyle(size).height;
  const options = useMemo(
    () =>
      fitOptions(
        minimapShown ? { width: mapWidth, height: mapHeight } : undefined,
      ),
    [minimapShown, mapWidth, mapHeight],
  );
  useEffect(() => {
    if (width > 0 && height > 0) {
      void flow.fitView(options);
    }
  }, [width, height, flow, options]);
  useEffect(() => {
    if (drawnKey > 0) {
      requestAnimationFrame(() => void flow.fitView(options));
    }
  }, [drawnKey, flow, options]);
  return options;
};

type FlowGraph = ReturnType<typeof toFlow>;

/** The graph canvas with its zoom controls, a minimap that fits the canvas, and the edge legend. */
const Canvas = ({
  nodes,
  edges,
  select,
  openDetails,
  drawnKey,
}: FlowGraph & {
  select: (table: string | undefined) => void;
  openDetails: (table: string) => void;
  drawnKey: number;
}) => {
  const { ref: canvasRef, size } = useSize();
  const minimap = useMinimap(size);
  const onNodeClick = useNodeClick(select, openDetails);
  useHandleMeasurement(nodes);
  const mapSize = minimapStyle(size);
  const options = useFit(size, minimap.shown, drawnKey);
  const label = minimap.shown ? "Hide minimap" : "Show minimap";
  return (
    <div className={styles.canvas} ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        minZoom={0.05}
        fitView
        fitViewOptions={options}
        proOptions={{ hideAttribution: true }}
        onError={onError}
        onNodeClick={onNodeClick}
        onPaneClick={() => select(undefined)}
      >
        <Background />
        <Controls showInteractive={false}>
          <ControlButton
            onClick={minimap.toggle}
            title={label}
            aria-label={label}
            aria-pressed={minimap.shown}
          >
            <span className="codicon codicon-map" />
          </ControlButton>
        </Controls>
        {minimap.shown ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            style={mapSize}
            nodeColor="var(--vscode-editorWidget-border, var(--vscode-disabledForeground))"
            nodeStrokeColor="var(--vscode-focusBorder)"
            nodeStrokeWidth={2}
            nodeBorderRadius={4}
          />
        ) : null}
      </ReactFlow>
      <Legend />
    </div>
  );
};

const Graph = (): React.JSX.Element => {
  const drawerRef = useRef<DrawerRef>(null);
  const [detailsTable, setDetailsTable] = useState<string>();
  const { settings, loaded, change } = useSettings();
  const openDetails = useCallback((table: string) => {
    setDetailsTable(table);
    drawerRef.current?.open();
  }, []);
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

  const { nodes, edges } = useMemo(() => {
    const data = lineageData(graph, {
      direct: settings.showSelectEdges,
      indirect: settings.showNonSelectEdges,
    });
    const drawn = new Set(data.tables.map((t) => t.table));
    const groups = collapsedGroups(graph);
    return toFlow({
      data,
      columns: graph.columns,
      columnTables: graph.columnTables,
      expansions: graph.expansions,
      pending: graph.pending,
      hidden: hiddenCounts(graph),
      groups,
      groupEdges: combinedEdges(graph, groups),
      chips: groupChips(graph),
      errors: graph.errors,
      selectedTable: graph.selectedTable,
      selectedColumn: graph.selectedColumn,
      columnsNeedStrict,
      refs: visibleRefs(refs, settings, drawn),
    });
  }, [graph, settings, refs, columnsNeedStrict]);
  const details = detailsTable ? graph.known[detailsTable] : undefined;

  return (
    <TableActionsContext value={actions}>
      <div className={`${styles.view} lineage-view`}>
        <div className={styles.topBar}>
          <MissingLineageMessage missingLineageMessage={notice} />
          <Toolbar settings={settings} change={change} reset={reset} />
        </div>
        <SemanticZoomContext value={settings.semanticZoom}>
          <Canvas
            nodes={nodes}
            edges={edges}
            select={select}
            openDetails={openDetails}
            drawnKey={drawnKey}
          />
        </SemanticZoomContext>
        <Drawer ref={drawerRef} title="Details">
          {details ? <TableDetails table={details} /> : null}
        </Drawer>
      </div>
    </TableActionsContext>
  );
};

/** The lineage panel: tables, their columns and column lineage drawn with React Flow and laid out by dagre. */
const LineageView = (): React.JSX.Element => (
  <ReactFlowProvider>
    <Graph />
  </ReactFlowProvider>
);

export default LineageView;
