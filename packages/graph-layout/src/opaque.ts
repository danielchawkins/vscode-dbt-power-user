import { entersBox, piecesOf } from "./drawingSegments.js";
import { indexed } from "./indexed.js";
import type { LayoutGraph, Point, Rect } from "./types.js";

/**
 * How far outside an opaque box a piece of an edge may run before it counts as touching the box. A piece within this
 * distance of the border is a breach as well as one through the interior, so an edge cannot hug a wall.
 */
const OPAQUE_CLEARANCE = 1;

/**
 * The clusters that hold each node, by node id: its own cluster and each ancestor of it. A node in no cluster has no
 * entry.
 */
export function holdersOf(graph: LayoutGraph): Map<string, Set<string>> {
  const parent = indexed(graph).clusterParent;
  const holders = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const set = new Set<string>();
    let cluster = node.cluster;
    while (cluster !== undefined && !set.has(cluster)) {
      set.add(cluster);
      cluster = parent.get(cluster);
    }
    holders.set(node.id, set);
  }
  return holders;
}

/**
 * The clusters an edge may enter an opaque box of: every cluster holding its source or its target (the ancestor
 * rule). A box held by neither end is foreign to the edge.
 */
export function allowedOf(
  holders: ReadonlyMap<string, ReadonlySet<string>>,
  source: string,
  target: string,
): Set<string> {
  return new Set([
    ...(holders.get(source) ?? []),
    ...(holders.get(target) ?? []),
  ]);
}

/** Whether a polyline runs through the interior of `box` or within `OPAQUE_CLEARANCE` of its border. */
function entersOpaque(points: readonly Point[], box: Rect): boolean {
  const grown = {
    x: box.x - OPAQUE_CLEARANCE,
    y: box.y - OPAQUE_CLEARANCE,
    width: box.width + 2 * OPAQUE_CLEARANCE,
    height: box.height + 2 * OPAQUE_CLEARANCE,
  };
  // The grown box holds the strict interior too, so one test covers both the interior and the clearance.
  return piecesOf(points).segments.some((segment) => entersBox(segment, grown));
}

/**
 * The opaque boxes a polyline breaches: those it enters that the edge is not allowed to enter. Returns their ids,
 * in the order of `boxes`.
 */
export function breachesOf(
  points: readonly Point[],
  boxes: ReadonlyMap<string, Rect>,
  allowed: ReadonlySet<string>,
): string[] {
  const breached: string[] = [];
  for (const [id, box] of boxes) {
    if (!allowed.has(id) && entersOpaque(points, box)) {
      breached.push(id);
    }
  }
  return breached;
}
