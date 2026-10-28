import type { LayeredGraph } from "../layering.js";
import type { LayoutHints } from "../types.js";

/** Passes in which a node without a place takes the mean of its neighbours' places, so chains of new nodes settle. */
const NEIGHBOUR_PASSES = 3;

/** The key of a node that nothing reaches: it sorts after every keyed node of its rank. */
const UNKEYED = Number.MAX_SAFE_INTEGER;

/**
 * The starting order of each rank, left to right, as layered node indices. With hints, a node the hints know keeps its
 * previous in-rank order, and a node they do not know (a new node, or a dummy) sits where its neighbours sit along
 * their ranks, after North and Woodhull (GD 2001). Without hints the order is depth-first from the top rank, so a node
 * follows the nodes it feeds.
 */
export function startingLayers(
  graph: LayeredGraph,
  hints: LayoutHints | undefined,
): number[][] {
  const keys =
    hints === undefined ? depthFirstKeys(graph) : hintKeys(graph, hints);
  const layers: number[][] = Array.from({ length: graph.ranks }, () => []);
  graph.nodes.forEach((node, x) => {
    if (graph.block[x] === x) {
      layers[node.rank]!.push(x);
    }
  });
  const blocks = blockMembers(graph);
  return layers.map((layer) =>
    layer
      .toSorted((a, b) => keys[a]! - keys[b]!)
      .flatMap((head) => blocks.get(head) ?? [head]),
  );
}

/**
 * Each owner with lateral port dummies, and its block in drawing order: the dummies before it, the owner, then the
 * dummies after it, each side nearest the owner first.
 */
function blockMembers(graph: LayeredGraph): Map<number, number[]> {
  const groups = new Map<number, number[]>();
  graph.nodes.forEach((node, x) => {
    if (node.port !== undefined) {
      const group = groups.get(node.port.owner) ?? [];
      group.push(x);
      groups.set(node.port.owner, group);
    }
  });
  return new Map(
    Array.from(groups, ([owner, dummies]) => {
      const before = nearestFirst(
        graph,
        dummies.filter((x) => graph.nodes[x]?.port?.after === false),
      ).reverse();
      const after = nearestFirst(
        graph,
        dummies.filter((x) => graph.nodes[x]?.port?.after === true),
      );
      return [owner, [...before, owner, ...after]] as const;
    }),
  );
}

/**
 * One side's dummies, nearest the owner first. Working outward, a dummy whose run leaves toward the band below takes
 * the largest offset still unplaced, and one whose run arrives from above takes the smallest, so its stub never lies
 * across a nearer run. Where the order cannot avoid a crossing, the smallest offset goes next.
 */
function nearestFirst(graph: LayeredGraph, dummies: number[]): number[] {
  const offsetOf = (x: number): number => graph.nodes[x]?.port?.offset ?? 0;
  const left = dummies.toSorted((a, b) => offsetOf(a) - offsetOf(b));
  const order: number[] = [];
  while (left.length > 0) {
    const last = left.length - 1;
    const below = graph.nodes[left[last]!]?.port?.below === true;
    order.push(...left.splice(below ? last : 0, 1));
  }
  return order;
}

/**
 * Each node's key on the scale of its own rank. A hinted node keeps its previous order: it takes the centre of its cell
 * among the hinted nodes of its rank, so a rank of `n` hinted nodes spans [0, n]. Any other node (a new node or a
 * dummy) takes the mean fraction of its neighbours, where a fraction is a position in [0, 1] along its rank. Its key is
 * that fraction on its own rank's span, so it never compares with the orders of another rank.
 */
function hintKeys(graph: LayeredGraph, hints: LayoutHints): number[] {
  const hinted: (number | undefined)[] = graph.nodes.map((node) =>
    node.id === undefined ? undefined : hints.nodes.get(node.id)?.order,
  );
  const members: number[][] = Array.from({ length: graph.ranks }, () => []);
  graph.nodes.forEach((node, x) => {
    if (hinted[x] !== undefined) {
      members[node.rank]!.push(x);
    }
  });
  const fractions: (number | undefined)[] = graph.nodes.map(() => undefined);
  for (const list of members) {
    list.sort((a, b) => hinted[a]! - hinted[b]! || a - b);
    list.forEach((x, k) => {
      fractions[x] = (k + 0.5) / list.length;
    });
  }
  const neighbours = neighbourLists(graph);
  for (let pass = 0; pass < NEIGHBOUR_PASSES; pass++) {
    fractions.forEach((fraction, x) => {
      if (fraction !== undefined) {
        return;
      }
      const known = neighbours[x]!.map((y) => fractions[y]).filter(
        (f): f is number => f !== undefined,
      );
      if (known.length > 0) {
        fractions[x] = known.reduce((sum, f) => sum + f, 0) / known.length;
      }
    });
  }
  return graph.nodes.map((node, x) => {
    const fraction = fractions[x];
    return fraction === undefined
      ? UNKEYED
      : fraction * Math.max(members[node.rank]!.length, 1);
  });
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
