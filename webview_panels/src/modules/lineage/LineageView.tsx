import type { lineage } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { Drawer, DrawerRef } from "@uicore";
import {
  Background,
  Controls,
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
import { useLineageGraph } from "./useLineageGraph";
import {
  ResolvedSettings,
  resolveSettings,
  tableActions,
  visibleRefs,
} from "./viewModel";

const nodeTypes = { table: TableNode };

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

const Graph = (): JSX.Element => {
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
  const flow = useReactFlow();

  tableActions.current = actions;

  useEffect(() => {
    if (drawnKey > 0) {
      requestAnimationFrame(() => void flow.fitView({ maxZoom: 1 }));
    }
  }, [drawnKey, flow]);

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
    <div className={styles.view}>
      <MissingLineageMessage missingLineageMessage={notice} />
      <Toolbar settings={settings} change={change} reset={reset} />
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          nodesDraggable={false}
          minZoom={0.05}
          fitView
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_event: unknown, node: { id: string }) =>
            select(node.id)
          }
          onPaneClick={() => select(undefined)}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <Legend />
      <Drawer ref={drawerRef} title="Details">
        {details ? <TableDetails table={details} /> : null}
      </Drawer>
    </div>
  );
};

/** The lineage panel: tables, their columns and column lineage drawn with React Flow and laid out by dagre. */
const LineageView = (): JSX.Element => (
  <ReactFlowProvider>
    <Graph />
  </ReactFlowProvider>
);

export default LineageView;
