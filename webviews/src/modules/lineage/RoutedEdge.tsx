import type { Edge, EdgeProps } from "@xyflow/react";
import { BaseEdge } from "@xyflow/react";
import { memo } from "react";
import type { RoutedEdgeData } from "./flow";
import styles from "./lineageGraph.module.css";

type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

/**
 * An edge of the layout: its path is the layout engine's routing, so React Flow's own handle geometry is not used.
 * The label, when there is one, sits at the middle of the path's longest run.
 */
const RoutedEdgeView = ({
  id,
  data,
  label,
  markerEnd,
  style,
}: EdgeProps<RoutedEdgeType>): React.JSX.Element | null => {
  if (!data) {
    return null;
  }
  return (
    <>
      <BaseEdge
        id={id}
        path={data.d}
        {...(markerEnd ? { markerEnd } : {})}
        style={style}
        interactionWidth={0}
      />
      {label ? (
        <text
          x={data.labelAt.x}
          y={data.labelAt.y}
          className={styles.edgeLabel}
        >
          {label}
        </text>
      ) : null}
    </>
  );
};

export const RoutedEdge = memo(RoutedEdgeView);
