import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { memo, use } from "react";
import type { GroupNode as GroupNodeType } from "./flow";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/** A closed group: a stacked card standing for the neighbours of one folder that are not drawn. */
const GroupNodeView = ({
  id,
  data,
}: NodeProps<GroupNodeType>): React.JSX.Element => {
  const actions = use(TableActionsContext);
  return (
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
      <button
        type="button"
        className="nodrag"
        aria-label={`Open ${data.label}`}
        title={`Open ${data.label}`}
        onClick={() => actions.openGroup(id)}
      >
        Open
      </button>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className={`${styles.handle} ${styles.headerHandle}`}
        isConnectable={false}
      />
    </div>
  );
};

export const GroupNode = memo(GroupNodeView);
