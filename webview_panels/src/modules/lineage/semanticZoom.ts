import type { Edge } from "@xyflow/react";
import { useStore } from "@xyflow/react";
import { createContext, use, useMemo } from "react";
import { drawnEdges } from "./flow";

/** Below this zoom, cards keep their size and show only a larger badge and title. */
export const ZOOM_OUT_BELOW = 0.5;

/** True when semantic zoom is `enabled` and `zoom` is below `ZOOM_OUT_BELOW`. */
export const isZoomedOut = (zoom: number, enabled: boolean): boolean =>
  enabled && zoom < ZOOM_OUT_BELOW;

/** Whether the `fusionPowerUser.lineage.semanticZoom` setting is on. */
export const SemanticZoomContext = createContext(true);

/**
 * True while the canvas is zoomed out. The selector returns a boolean, so a node re-renders only when the zoom
 * crosses the threshold.
 */
export const useZoomedOut = (): boolean => {
  const enabled = use(SemanticZoomContext);
  return useStore((s) => isZoomedOut(s.transform[2], enabled));
};

/**
 * The edges React Flow draws at the current zoom. The memo keeps the array stable while the zoom stays on the same side
 * of the threshold.
 */
export const useDrawnEdges = (edges: Edge[]): Edge[] => {
  const zoomedOut = useZoomedOut();
  return useMemo(() => drawnEdges(edges, zoomedOut), [edges, zoomedOut]);
};
