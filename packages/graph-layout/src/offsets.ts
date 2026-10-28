import type { LayoutEdge, LayoutNode, LayoutOptions, Side } from "./types.js";

/** The side of a node that faces the next rank, and the side that faces the previous one, for each direction. */
export const TOWARD_LOWER: Record<LayoutOptions["direction"], Side> = {
  down: "south",
  right: "east",
};
export const TOWARD_UPPER: Record<LayoutOptions["direction"], Side> = {
  down: "north",
  right: "west",
};

/** The node's extent along the in-rank axis: its width when ranks run down, its height when they run right. */
export function inRankExtent(
  node: LayoutNode,
  direction: LayoutOptions["direction"],
): number {
  return direction === "down" ? node.width : node.height;
}

/**
 * The mean offset, from the node's centre, of the port that each member names at one end. A member that names no
 * port, or a port on another side, contributes zero.
 */
export function meanPortOffset(
  members: readonly LayoutEdge[],
  end: "source" | "target",
  at: { node: LayoutNode; breadth: number; side: Side },
): number {
  const total = members.reduce((sum, e) => {
    const portId = end === "source" ? e.sourcePort : e.targetPort;
    const port =
      portId === undefined
        ? undefined
        : at.node.ports?.find((p) => p.id === portId);
    return port === undefined || port.side !== at.side
      ? sum
      : sum + port.offset - at.breadth / 2;
  }, 0);
  return total / members.length;
}
