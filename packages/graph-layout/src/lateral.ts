import type { LayoutNode, LayoutOptions, LayoutPort, Side } from "./types.js";

/**
 * The two sides of a node that lie across the flow: west and east when ranks run down, north and south when they run
 * right. `after` is the side whose in-rank coordinate is the greater.
 */
const LATERAL: Record<
  LayoutOptions["direction"],
  { before: Side; after: Side }
> = {
  down: { before: "west", after: "east" },
  right: { before: "north", after: "south" },
};

/** A port on a side lateral to the flow, and whether that side lies after the node in the in-rank order. */
export interface LateralPort {
  port: LayoutPort;
  after: boolean;
}

/**
 * The port that `portId` names on `node`, when the port sits on a side lateral to the flow. Undefined for no port, an
 * unknown port, or a port on a flow side, which the bands handle without a dummy.
 */
export function lateralPort(
  node: LayoutNode | undefined,
  portId: string | undefined,
  direction: LayoutOptions["direction"],
): LateralPort | undefined {
  if (node === undefined || portId === undefined) {
    return undefined;
  }
  const port = node.ports?.find((p) => p.id === portId);
  const sides = LATERAL[direction];
  if (port === undefined) {
    return undefined;
  }
  if (port.side === sides.after) {
    return { port, after: true };
  }
  return port.side === sides.before ? { port, after: false } : undefined;
}
