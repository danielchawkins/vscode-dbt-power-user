import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

/**
 * Re-measures the handles of every drawn node, in one batch, after each new `nodes`. React Flow drops a node's
 * handle bounds whenever its user node is replaced and carries no `measured`, which leaves its edges undrawn.
 */
export const useHandleMeasurement = (
  nodes: readonly { id: string }[],
): void => {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(nodes.map((n) => n.id));
  }, [nodes, updateNodeInternals]);
};
