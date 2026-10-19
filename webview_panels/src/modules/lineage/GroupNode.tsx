import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { memo } from "react";
import type { GroupNode as GroupNodeType } from "./flow";
import styles from "./lineageGraph.module.css";

/** A closed group: a stacked card standing for the neighbours of one folder that are not drawn. */
const GroupNodeView = ({
  data,
}: NodeProps<GroupNodeType>): React.JSX.Element => (
  <div className={`${styles.node} ${styles.group}`} data-group={data.label}>
    <Handle
      type="target"
      position={Position.Left}
      id="in"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
    <span className={styles.groupLabel} title={data.label}>
      {data.label}
    </span>
    <span className={styles.groupCount}>{data.count}</span>
    <Handle
      type="source"
      position={Position.Right}
      id="out"
      className={`${styles.handle} ${styles.headerHandle}`}
      isConnectable={false}
    />
  </div>
);

export const GroupNode = memo(GroupNodeView);
