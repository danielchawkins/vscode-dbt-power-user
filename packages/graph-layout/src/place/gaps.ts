import type { LayeredGraph } from "../layering.js";
import type { Spacing } from "../types.js";

/** Each rank's centre across the drawing: ranks are stacked from the origin, with `gap` between their extents. */
export function rankCentres(half: readonly number[], gap: number): number[] {
  const centres: number[] = [];
  let edge = 0;
  for (const h of half) {
    centres.push(edge + h);
    edge += 2 * h + gap;
  }
  return centres;
}

/**
 * The least gap between each node and its left neighbour in its rank: half of each breadth plus a spacing. Two nodes of
 * one block (an owner and its lateral port dummies) and two chain dummies keep the edge spacing. Otherwise the gap is
 * the node spacing when each side is a real node or a port dummy, so the stubs of one card stay apart from the next
 * card. The leftmost node of a rank has no gap.
 */
export function gapsLeft(
  layers: readonly (readonly number[])[],
  layered: LayeredGraph,
  spacing: Pick<Spacing, "node" | "edge">,
): number[] {
  const { nodes, block } = layered;
  const anchored = (x: number): boolean =>
    nodes[x]?.id !== undefined || nodes[x]?.port !== undefined;
  const gaps = nodes.map(() => 0);
  for (const layer of layers) {
    layer.slice(1).forEach((v, k) => {
      const u = layer[k]!;
      const sameBlock = block[u] === block[v];
      const gap =
        !sameBlock && anchored(u) && anchored(v) ? spacing.node : spacing.edge;
      gaps[v] = (nodes[u]!.breadth + nodes[v]!.breadth) / 2 + gap;
    });
  }
  return gaps;
}
