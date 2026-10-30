import { panelLogger } from "@modules/logger";
import {
  type FitViewOptions,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  useStoreApi,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type RefObject, use } from "react";
import { MIN_ZOOM } from "./fit";
import type { toFlow } from "./flow";
import { GroupNode } from "./GroupNode";
import { LayerBand } from "./LayerBand";
import styles from "./lineageGraph.module.css";
import { minimapColour, minimapSize, minimapStroke } from "./minimap";
import { RelationshipEdgeView } from "./RelationshipEdge";
import relationStyles from "./relationshipEdges.module.css";
import { RoutedEdge } from "./RoutedEdge";
import {
  isZoomedOut,
  SemanticZoomContext,
  useDrawnEdges,
} from "./semanticZoom";
import { TableNode } from "./TableNode";
import { useFit, useMinimap } from "./useCanvasFit";
import { useHandleMeasurement } from "./useHandleMeasurement";

type FlowGraph = ReturnType<typeof toFlow>;

/** Logs React Flow's warnings to the webview devtools console. */
const onError = (code: string, message: string) => {
  panelLogger.warn(`[React Flow] ${code}: ${message}`);
};

const nodeTypes = { table: TableNode, folderGroup: GroupNode, band: LayerBand };
const edgeTypes = {
  routed: RoutedEdge,
  relationship: RelationshipEdgeView,
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
      <span className={relationStyles.legendLine} />
      Relationship
    </span>
  </div>
);

/** The zoom controls, and the button that shows and hides the minimap. */
const CanvasControls = ({
  options,
  refit,
  minimap,
}: {
  options: FitViewOptions;
  refit: () => void;
  minimap: ReturnType<typeof useMinimap>;
}) => {
  const label = minimap.shown ? "Hide minimap" : "Show minimap";
  return (
    <Controls
      showInteractive={false}
      fitViewOptions={options}
      onFitView={refit}
    >
      <ControlButton
        onClick={minimap.toggle}
        title={label}
        aria-label={label}
        aria-pressed={minimap.shown}
      >
        <span className="codicon codicon-map" />
      </ControlButton>
    </Controls>
  );
};

/** The graph canvas with its zoom controls, a minimap that fits the canvas, and the edge legend. */
export const Canvas = ({
  nodes,
  edges,
  select,
  hover,
  openDetails,
  drawnKey,
  nodeKey,
  shapeKey,
  overlap,
  canvasRef,
  size,
}: FlowGraph & {
  select: (table: string | undefined) => void;
  /** Follows the pointer over a card, for the path highlight. */
  hover: (table: string | undefined) => void;
  openDetails: (table: string) => void;
  drawnKey: number;
  nodeKey: string;
  shapeKey: string;
  /** How far the notice covers the canvas's top edge, which the fit keeps clear of. */
  overlap: number;
  canvasRef: RefObject<HTMLDivElement | null>;
  size: { width: number; height: number };
}): React.JSX.Element => {
  const minimap = useMinimap(size);
  const onNodeClick = useNodeClick(select, openDetails);
  useHandleMeasurement(nodes);
  const mapSize = minimapSize(size);
  const focusId = nodes.find((n) => n.type === "table" && n.data.isStart)?.id;
  const { options, refit } = useFit({
    size,
    minimapShown: minimap.shown,
    notice: overlap,
    drawnKey,
    focusId,
    nodeKey,
    shapeKey,
  });
  const drawn = useDrawnEdges(edges);
  return (
    <div className={styles.canvas} ref={canvasRef}>
      <ReactFlow
        nodes={nodes}
        edges={drawn}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        minZoom={MIN_ZOOM}
        fitView
        fitViewOptions={options}
        proOptions={{ hideAttribution: true }}
        onError={onError}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) =>
          hover(node.type === "table" ? node.id : undefined)
        }
        onNodeMouseLeave={() => hover(undefined)}
        onPaneClick={() => select(undefined)}
      >
        <CanvasControls options={options} refit={refit} minimap={minimap} />
        {minimap.shown ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            style={mapSize}
            nodeColor={minimapColour}
            nodeStrokeColor={minimapStroke}
            nodeStrokeWidth={2}
            nodeBorderRadius={4}
          />
        ) : null}
      </ReactFlow>
      <Legend />
    </div>
  );
};
