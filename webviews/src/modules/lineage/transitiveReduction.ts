import type { Edge } from "@xyflow/react";
import { hintEdgeId } from "./edgeIds";
import { drawsTableEdges, type LayoutInput } from "./engine/layoutRequest";

/** A dependency edge as its `[parent, child]` pair. */
type Pair = [parent: string, child: string];

/** The layout input without the edges transitive reduction drops, and the edges it dropped, in input order. */
export interface TransitiveReduction {
  layout: LayoutInput;
  dropped: Pair[];
}

const keyOf = ([parent, child]: Pair): string => `${parent}\0${child}`;

/** Whether `to` is reached from `from` along the successors, with the edge from `from` to `to` already taken out. */
const reaches = (
  successors: Map<string, Set<string>>,
  from: string,
  to: string,
): boolean => {
  const seen = new Set<string>([from]);
  const queue = [from];
  for (const node of queue) {
    for (const next of successors.get(node) ?? []) {
      if (next === to) {
        return true;
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

/**
 * The pairs another path implies, in input order. Each pair is tested against the pairs still kept, so removing one
 * never breaks a path another pair relies on: in a cycle the kept pairs reach exactly what the input reaches.
 */
const redundantPairs = (pairs: readonly Pair[]): Pair[] => {
  const successors = new Map<string, Set<string>>();
  for (const [parent, child] of pairs) {
    const children = successors.get(parent) ?? new Set<string>();
    children.add(child);
    successors.set(parent, children);
  }
  const tested = new Set<string>();
  const redundant: Pair[] = [];
  for (const pair of pairs) {
    const key = keyOf(pair);
    if (tested.has(key)) {
      continue;
    }
    tested.add(key);
    const [parent, child] = pair;
    successors.get(parent)?.delete(child);
    if (reaches(successors, parent, child)) {
      redundant.push(pair);
    } else {
      successors.get(parent)?.add(child);
    }
  }
  return redundant;
};

/**
 * The layout input without each dependency edge that another path of at least two edges already implies: `u->v` goes
 * when `v` is reachable from `u` without it. The table and group edges are the dependencies; the column and
 * relationship edges are kept. Off, or with no table edge drawn, returns `layout` itself, so switching it off restores
 * the input exactly.
 */
export const withoutTransitiveEdges = (
  layout: LayoutInput,
  on: boolean,
): TransitiveReduction => {
  if (!on || !drawsTableEdges(layout)) {
    return { layout, dropped: [] };
  }
  const dropped = redundantPairs([
    ...layout.data.edges,
    ...(layout.groupEdges ?? []),
  ]);
  if (dropped.length === 0) {
    return { layout, dropped };
  }
  const gone = new Set(dropped.map(keyOf));
  const kept = (pair: Pair) => !gone.has(keyOf(pair));
  return {
    layout: {
      ...layout,
      data: { ...layout.data, edges: layout.data.edges.filter(kept) },
      groupEdges: layout.groupEdges?.filter(kept),
    },
    dropped,
  };
};

/**
 * The dropped edges as hints: a thin dashed straight line between their two cards, which no layout routes. A hint
 * whose end is not drawn is left out.
 */
export const hintEdges = (
  dropped: readonly Pair[],
  drawn: ReadonlySet<string>,
): Edge[] =>
  dropped
    .filter(([parent, child]) => drawn.has(parent) && drawn.has(child))
    .map(([parent, child]) => ({
      id: hintEdgeId(parent, child),
      type: "straight",
      source: parent,
      target: child,
      sourceHandle: "out",
      targetHandle: "in",
      className: "lineage-hint-edge",
    }));
