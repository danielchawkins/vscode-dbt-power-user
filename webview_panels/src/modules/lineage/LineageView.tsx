import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { Drawer, DrawerRef } from "@uicore";
import {
  Background,
  ControlButton,
  Controls,
  FitViewOptions,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toFlow } from "./flow";
import { lineageData } from "./graph";
import styles from "./lineageGraph.module.css";
import MissingLineageMessage from "./MissingLineageMessage";
import { fetchRelationships, fetchSettings, persistSettings } from "./requests";
import TableDetails from "./TableDetails";
import { TableNode } from "./TableNode";
import Toolbar from "./Toolbar";
import { useHandleMeasurement } from "./useHandleMeasurement";
import { useLineageGraph } from "./useLineageGraph";
import {
  ResolvedSettings,
  resolveSettings,
  tableActions,
  visibleRefs,
} from "./viewModel";

const nodeTypes = { table: TableNode };

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

/** The host's view settings; a change is applied at once and persisted through `persistLineageSettings`. */
const useSettings = () => {
  const [settings, setSettings] = useState<ResolvedSettings>(() =>
    resolveSettings(undefined),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    fetchSettings()
      .then((s) => setSettings(resolveSettings(s)))
      .catch((error) => panelLogger.error("lineage settings", error));
  }, []);
  const change = (part: Partial<lineage.LineageSettings>) => {
    setSettings((s) => resolveSettings({ ...s, ...part }));
    persistSettings(part).catch((error) =>
      panelLogger.error("lineage settings", error),
    );
  };
  return { settings, settingsRef, change };
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

type FlowGraph = ReturnType<typeof toFlow>;

/** The graph canvas with its zoom controls, a minimap that fits the canvas, and the edge legend. */
const Canvas = ({
  nodes,
  edges,
  select,
  drawnKey,
}: FlowGraph & {
  select: (table: string | undefined) => void;
  drawnKey: number;
}) => {
  const canvas = useSize();
  const minimap = useMinimap(canvas.size);
  const flow = useReactFlow();
  useHandleMeasurement(nodes);
  const { width, height } = canvas.size;
  const mapSize = minimapStyle(canvas.size);
  const mapWidth = mapSize.width;
  const mapHeight = mapSize.height;
  const options = useMemo(
    () =>
      fitOptions(
        minimap.shown ? { width: mapWidth, height: mapHeight } : undefined,
      ),
    [minimap.shown, mapWidth, mapHeight],
  );
  // Re-fit after the panel is resized, so a shrunk panel still shows the whole graph.
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
  const label = minimap.shown ? "Hide minimap" : "Show minimap";
  return (
    <div className={styles.canvas} ref={canvas.ref}>
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
        onNodeClick={(_event: unknown, node: { id: string }) => select(node.id)}
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
            style={minimapStyle(canvas.size)}
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
  const { settings, settingsRef, change } = useSettings();
  const openDetails = useCallback((table: string) => {
    setDetailsTable(table);
    drawerRef.current?.open();
  }, []);
  const defaultExpansion = useCallback(
    () => settingsRef.current.defaultExpansion,
    [settingsRef],
  );
  const { graph, notice, drawnKey, actions, select, reset } = useLineageGraph(
    defaultExpansion,
    openDetails,
  );
  const refs = useRefs(settings, drawnKey);

  tableActions.current = actions;

  const { nodes, edges } = useMemo(() => {
    const data = lineageData(graph, {
      direct: settings.showSelectEdges,
      indirect: settings.showNonSelectEdges,
    });
    const drawn = new Set(data.tables.map((t) => t.table));
    return toFlow({
      data,
      columns: graph.columns,
      columnTables: graph.columnTables,
      expansions: graph.expansions,
      errors: graph.errors,
      selectedTable: graph.selectedTable,
      selectedColumn: graph.selectedColumn,
      refs: visibleRefs(refs, settings, drawn),
    });
  }, [graph, settings, refs]);
  const details = detailsTable ? graph.known[detailsTable] : undefined;

  return (
    <div className={`${styles.view} lineage-view`}>
      <div className={styles.topBar}>
        <MissingLineageMessage missingLineageMessage={notice} />
        <Toolbar settings={settings} change={change} reset={reset} />
      </div>
      <Canvas nodes={nodes} edges={edges} select={select} drawnKey={drawnKey} />
      <Drawer ref={drawerRef} title="Details">
        {details ? <TableDetails table={details} /> : null}
      </Drawer>
    </div>
  );
};

/** The lineage panel: tables, their columns and column lineage drawn with React Flow and laid out by dagre. */
const LineageView = (): React.JSX.Element => (
  <ReactFlowProvider>
    <Graph />
  </ReactFlowProvider>
);

export default LineageView;
