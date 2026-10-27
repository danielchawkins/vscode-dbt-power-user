import type { LayeredGraph } from "../layering.js";
import type { LayoutHints } from "../types.js";

/** Passes in which a node without a key takes the mean of its neighbours' keys, so chains of new nodes settle. */
const NEIGHBOUR_PASSES = 3;

/** The key of a node that nothing reaches: it sorts after every keyed node of its rank. */
const UNKEYED = Number.MAX_SAFE_INTEGER;

/**
 * The starting order of each rank, left to right, as layered node indices. With hints, a node the hints know keeps its
 * previous in-rank order, and a node they do not know (a new node, or a dummy) sits at the mean of its neighbours'
 * keys, after North and Woodhull (GD 2001). Without hints the order is depth-first from the top rank, so a node
 * follows the nodes it feeds.
 */
export function startingLayers(
  graph: LayeredGraph,
  hints: LayoutHints | undefined,
): number[][] {
  const keys =
    hints === undefined ? depthFirstKeys(graph) : hintKeys(graph, hints);
  const layers: number[][] = Array.from({ length: graph.ranks }, () => []);
  graph.nodes.forEach((node, x) => layers[node.rank]!.push(x));
  return layers.map((layer) => layer.toSorted((a, b) => keys[a]! - keys[b]!));
}

/** Each node's previous order where the hints know it, the mean of its keyed neighbours' keys otherwise. */
function hintKeys(graph: LayeredGraph, hints: LayoutHints): number[] {
  const keys: (number | undefined)[] = graph.nodes.map((node) =>
    node.id === undefined ? undefined : hints.nodes.get(node.id)?.order,
  );
  const neighbours = neighbourLists(graph);
  for (let pass = 0; pass < NEIGHBOUR_PASSES; pass++) {
    keys.forEach((key, x) => {
      if (key !== undefined) {
        return;
      }
      const known = neighbours[x]!.map((y) => keys[y]).filter(
        (k): k is number => k !== undefined,
      );
      if (known.length > 0) {
        keys[x] = known.reduce((sum, k) => sum + k, 0) / known.length;
      }
    });
  }
  return keys.map((key) => key ?? UNKEYED);
}

/** The position of each node in a depth-first walk from the top rank down, rank by rank. */
function depthFirstKeys(graph: LayeredGraph): number[] {
  const lower: number[][] = graph.nodes.map(() => []);
  for (const s of graph.segments) {
    lower[s.top]!.push(s.bottom);
  }
  const layers: number[][] = Array.from({ length: graph.ranks }, () => []);
  graph.nodes.forEach((node, x) => layers[node.rank]!.push(x));
  const keys: number[] = graph.nodes.map(() => UNKEYED);
  let next = 0;
  const seen: boolean[] = graph.nodes.map(() => false);
  for (const layer of layers) {
    for (const start of layer) {
      const stack = [start];
      while (stack.length > 0) {
        const x = stack.pop()!;
        if (seen[x]) {
          continue;
        }
        seen[x] = true;
        keys[x] = next++;
        for (const y of lower[x]!) {
          stack.push(y);
        }
      }
    }
  }
  return keys;
}

/** The nodes linked to each node by a segment, in either direction. */
function neighbourLists(graph: LayeredGraph): number[][] {
  const lists: number[][] = graph.nodes.map(() => []);
  for (const s of graph.segments) {
    lists[s.top]!.push(s.bottom);
    lists[s.bottom]!.push(s.top);
  }
  return lists;
}
