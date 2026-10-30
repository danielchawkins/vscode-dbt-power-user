import type { DrawerRef } from "@uicore";
import { Drawer } from "@uicore";
import { ReactFlowProvider } from "@xyflow/react";
import { useRef } from "react";
import { Canvas } from "./Canvas";
import styles from "./lineageGraph.module.css";
import MissingLineageMessage from "./MissingLineageMessage";
import { SemanticZoomContext } from "./semanticZoom";
import TableDetails from "./TableDetails";
import Toolbar from "./Toolbar";
import { useNoticeOverlap, useSize } from "./useCanvasFit";
import { useGraphModel } from "./useGraphModel";
import { TableActionsContext } from "./viewModel";

const Graph = (): React.JSX.Element => {
  const drawerRef = useRef<DrawerRef>(null);
  const model = useGraphModel(drawerRef);
  const topBarRef = useRef<HTMLDivElement>(null);
  const { ref: canvasRef, size } = useSize();
  const overlap = useNoticeOverlap(
    topBarRef,
    canvasRef,
    model.notice !== undefined,
  );
  const { settings } = model;

  return (
    <TableActionsContext value={model.actions}>
      <div
        className={`${styles.view} lineage-view`}
        style={
          {
            "--lineage-edge-opacity": settings.edgeOpacity,
          } as React.CSSProperties
        }
      >
        <div className={styles.topBar} ref={topBarRef}>
          <MissingLineageMessage missingLineageMessage={model.notice} />
          <Toolbar
            settings={settings}
            change={model.change}
            reset={model.reset}
          />
        </div>
        <SemanticZoomContext value={settings.semanticZoom}>
          <Canvas
            nodes={model.nodes}
            edges={model.edges}
            select={model.select}
            hover={model.hover}
            openDetails={model.openDetails}
            drawnKey={model.drawnKey}
            nodeKey={model.nodeKey}
            shapeKey={model.shapeKey}
            overlap={overlap}
            canvasRef={canvasRef}
            size={size}
          />
        </SemanticZoomContext>
        <Drawer ref={drawerRef} title="Details">
          {model.details ? <TableDetails table={model.details} /> : null}
        </Drawer>
      </div>
    </TableActionsContext>
  );
};

/** The lineage panel: tables, their columns and column lineage drawn with React Flow and laid out by the graph-layout engine. */
const LineageView = (): React.JSX.Element => (
  <ReactFlowProvider>
    <Graph />
  </ReactFlowProvider>
);

export default LineageView;
