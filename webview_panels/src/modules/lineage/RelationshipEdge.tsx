import type { lineage } from "@fusion-power-user/webview-contract";
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { useState } from "react";
import styles from "./relationshipEdges.module.css";
import { endMark, relationEnds, relationTitle } from "./relationshipMarks";
import type { RoutedRelationshipData } from "./relationshipRoute";

/**
 * A declared relationship edge: the ref it draws, its routed path in the layered layout, and its React Flow type.
 * Without a routed path the edge is a bezier between the handles.
 */
export type RelationshipEdge = Edge<
  { ref: lineage.LineageRef; routed?: RoutedRelationshipData | undefined },
  "relationship"
>;

/**
 * A dotted relationship edge with a crow's foot at the declaring (many) end and a bar at the referenced (one) end. It
 * has no arrowhead; hovering it shows its columns and the source that declares it.
 */
export const RelationshipEdgeView = ({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps<RelationshipEdge>): React.JSX.Element | null => {
  const [hovered, setHovered] = useState(false);
  if (!data) {
    return null;
  }
  const { ref, routed } = data;
  const [path, labelX, labelY] = routed
    ? [routed.d, routed.labelAt.x, routed.labelAt.y]
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });
  const [sourceEnd, targetEnd] = routed
    ? [routed.source, routed.target]
    : [
        { x: sourceX, y: sourceY, position: sourcePosition },
        { x: targetX, y: targetY, position: targetPosition },
      ];
  const ends = relationEnds(ref.cardinality);
  const marks = [
    endMark(ends.to, sourceEnd.x, sourceEnd.y, sourceEnd.position),
    endMark(ends.from, targetEnd.x, targetEnd.y, targetEnd.position),
  ].join(" ");
  const title = relationTitle(ref);
  return (
    <g className={styles.edge}>
      <BaseEdge id={id} path={path} className={styles.line} />
      <path d={marks} className={styles.mark} />
      <path
        d={path}
        className={styles.hit}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      />
      {hovered ? (
        <EdgeLabelRenderer>
          <div
            className={styles.tip}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <div>{title.columns}</div>
            <div className={styles.source}>{title.source}</div>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
};
