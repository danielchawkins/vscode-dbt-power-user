import type { LayeredGraph } from "../layering.js";
import type { LayoutCluster } from "../types.js";
import { siblingOrder, siblings } from "./boxOrder.js";
import type { Separation } from "./vpsc.js";

/** Space between a box and its outermost members when its cluster sets no padding. */
const DEFAULT_PADDING = 8;

/** A cluster's box: its cluster index, its edge variables, its members and the ranks it spans. */
interface Box {
  /** The cluster's id. */
  id: string;
  /** Index of the cluster in `LayoutGraph.clusters`. */
  cluster: number;
  /** Index of the parent cluster, when it is nested. */
  parent: number | undefined;
  /** Variables of the left and right edges, after the layered nodes. */
  left: number;
  right: number;
  /** Layered nodes inside the box, including those of nested clusters. */
  members: number[];
  /** The first and last rank the box spans. */
  top: number;
  bottom: number;
  padding: number;
  labelHeight: number;
}

/** The boxes of a drawing, and the separations among the nodes and box edges that keep them apart. */
export interface BoxPlan {
  boxes: Box[];
  /** Variables beyond the layered nodes: a left and a right edge per box. */
  count: number;
  /** Rank chains, box edges around members and neighbours, nesting, and the order of siblings. */
  separations: Separation[];
}

/** What the box plan is built from: the layered graph, its ranks' order, and the sizes and gaps of its nodes. */
export interface BoxInput {
  layered: LayeredGraph;
  layers: readonly (readonly number[])[];
  clusters: readonly LayoutCluster[];
  /** Least distance between each node's centre and its left neighbour's, as in `Problem`. */
  gapLeft: readonly number[];
  /** Half the in-rank breadth of each layered node. */
  half: readonly number[];
  /** Least space between sibling boxes, and between a box and a node outside it. */
  spacing: number;
}

/**
 * Plans one box per cluster that has members. A box's left and right edges are variables after the layered nodes, so
 * the separations are all of the form x[to] - x[from] >= gap. Each box keeps its members inside with its padding, and
 * each node next to a box stays outside it. A nested box keeps its parent's padding. Sibling boxes that share a rank
 * keep one order, which the ordering makes consistent, so that no two of them overlap in that rank.
 */
export function planBoxes(input: BoxInput): BoxPlan {
  const boxes = boxesOf(input);
  const byCluster = new Map(boxes.map((box) => [box.cluster, box] as const));
  const separations: Separation[] = [];
  for (const layer of input.layers) {
    separations.push(...chainOf(layer, input.gapLeft));
    for (const [cluster, [f, l]] of spansOf(layer, input.layered.paths)) {
      const box = byCluster.get(cluster);
      if (box !== undefined) {
        separations.push(...edgesOf(input, box, { layer, f, l }));
      }
    }
  }
  const order = siblingOrder(
    input.layers,
    input.layered.paths,
    input.clusters.length,
  );
  separations.push(...nesting(boxes, byCluster));
  separations.push(...siblings(order, byCluster, input.spacing));
  return { boxes, count: 2 * boxes.length, separations };
}

/** One box per cluster with members, its edges numbered after the layered nodes. */
function boxesOf(input: BoxInput): Box[] {
  const { layered, clusters } = input;
  const n = layered.nodes.length;
  const members: number[][] = clusters.map(() => []);
  layered.paths.forEach((path, x) => path.forEach((c) => members[c]!.push(x)));
  const number = new Map(clusters.map((c, i) => [c.id, i] as const));
  const boxes: Box[] = [];
  clusters.forEach((cluster, c) => {
    const nodes = members[c]!;
    if (nodes.length === 0) {
      return;
    }
    const ranks = nodes.map((x) => layered.nodes[x]!.rank);
    boxes.push({
      id: cluster.id,
      cluster: c,
      parent:
        cluster.parent === undefined ? undefined : number.get(cluster.parent),
      left: n + 2 * boxes.length,
      right: n + 2 * boxes.length + 1,
      members: nodes,
      top: ranks.reduce((low, r) => Math.min(low, r), Infinity),
      bottom: ranks.reduce((high, r) => Math.max(high, r), -Infinity),
      padding: cluster.padding ?? DEFAULT_PADDING,
      labelHeight: cluster.labelHeight ?? 0,
    });
  });
  return boxes;
}

/** The rank chain of one rank: each node at least its gap beyond its left neighbour. */
function chainOf(
  layer: readonly number[],
  gapLeft: readonly number[],
): Separation[] {
  return layer.slice(1).map((v, k) => ({
    from: layer[k]!,
    to: v,
    gap: gapLeft[v]!,
  }));
}

/** The first and last position in a rank of the members of each cluster there. */
function spansOf(
  layer: readonly number[],
  paths: readonly (readonly number[])[],
): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  layer.forEach((x, k) => {
    for (const c of paths[x]!) {
      const span = spans.get(c);
      if (span === undefined) {
        spans.set(c, [k, k]);
      } else {
        span[1] = k;
      }
    }
  });
  return spans;
}

/**
 * The separations of one box in one rank, where its members run from position f to l: the edges sit outside the
 * outermost members by the padding, and the nodes beside the run sit outside the edges.
 */
function edgesOf(
  input: BoxInput,
  box: Box,
  { layer, f, l }: { layer: readonly number[]; f: number; l: number },
): Separation[] {
  const { half, spacing } = input;
  const first = layer[f]!;
  const last = layer[l]!;
  const out: Separation[] = [
    { from: box.left, to: first, gap: box.padding + half[first]! },
    { from: last, to: box.right, gap: box.padding + half[last]! },
  ];
  if (f > 0) {
    const u = layer[f - 1]!;
    out.push({ from: u, to: box.left, gap: half[u]! + spacing });
  }
  if (l + 1 < layer.length) {
    const w = layer[l + 1]!;
    out.push({ from: box.right, to: w, gap: half[w]! + spacing });
  }
  return out;
}

/** A child box lies inside its parent box, the parent's padding apart on each side. */
function nesting(
  boxes: readonly Box[],
  byCluster: ReadonlyMap<number, Box>,
): Separation[] {
  return boxes.flatMap((box) => {
    const parent =
      box.parent === undefined ? undefined : byCluster.get(box.parent);
    if (parent === undefined) {
      return [];
    }
    return [
      { from: parent.left, to: box.left, gap: parent.padding },
      { from: box.right, to: parent.right, gap: parent.padding },
    ];
  });
}

/** The starting edges of every box, from its members' starting positions, as `[left, right]` pairs flattened. */
export function initialEdges(
  plan: BoxPlan,
  x: readonly number[],
  half: readonly number[],
): number[] {
  return plan.boxes.flatMap((box) => {
    let left = Infinity;
    let right = -Infinity;
    for (const m of box.members) {
      left = Math.min(left, x[m]! - half[m]! - box.padding);
      right = Math.max(right, x[m]! + half[m]! + box.padding);
    }
    return [left, right];
  });
}

/**
 * The across-rank extent of each box, from the centres and half-heights of its first and last ranks, widened by its
 * padding and label; a parent is widened to hold each child box with the parent's padding.
 */
export function acrossExtents(
  plan: BoxPlan,
  centres: readonly number[],
  rankHalf: readonly number[],
): { top: number; bottom: number }[] {
  const index = new Map(plan.boxes.map((box, i) => [box.cluster, i] as const));
  const extent = plan.boxes.map((box) => ({
    top: centres[box.top]! - rankHalf[box.top]! - box.padding - box.labelHeight,
    bottom: centres[box.bottom]! + rankHalf[box.bottom]! + box.padding,
  }));
  const depth = (box: Box): number => {
    let d = 0;
    let p = box.parent;
    while (p !== undefined && index.has(p)) {
      d += 1;
      p = plan.boxes[index.get(p)!]!.parent;
    }
    return d;
  };
  const deepestFirst = plan.boxes
    .map((box, i) => ({ i, d: depth(box) }))
    .sort((a, b) => b.d - a.d);
  for (const { i } of deepestFirst) {
    const parent = plan.boxes[i]!.parent;
    const p = parent === undefined ? undefined : index.get(parent);
    if (p !== undefined) {
      const padding = plan.boxes[p]!.padding;
      extent[p]!.top = Math.min(extent[p]!.top, extent[i]!.top - padding);
      extent[p]!.bottom = Math.max(
        extent[p]!.bottom,
        extent[i]!.bottom + padding,
      );
    }
  }
  return extent;
}
