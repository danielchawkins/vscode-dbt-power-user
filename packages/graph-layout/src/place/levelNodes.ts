import { components } from "../constraints/components.js";
import type { Separation } from "../constraints/types.js";
import type { LayeredGraph } from "../layeredGraph.js";
import type { LayoutGraph, LayoutOptions, Spacing } from "../types.js";

/** What the across separations of the layered nodes are drawn from. */
export interface LevelNodeInput {
  layered: LayeredGraph;
  /** Which bundles are directed: see `directedBundles`. */
  directed: readonly boolean[];
  /** Each layered node's position along the ranks, and half its extent there. */
  inRank: readonly number[];
  halfIn: readonly number[];
  /** Each layered node's half-extent across the ranks. */
  halfAcross: readonly number[];
  /** The gap between rank r and rank r + 1, as the rows use it. */
  rankGap: readonly number[];
  spacing: Pick<Spacing, "node" | "edge">;
}

/**
 * Which bundles constrain the across axis: those of an edge kind that ranks, whose ends are not in one strongly
 * connected component of the ranking graph. A cycle's edges are reversed by the ranking, so they carry no direction.
 */
export function directedBundles(
  graph: LayoutGraph,
  layered: LayeredGraph,
  options: LayoutOptions,
): boolean[] {
  const ranks = (kind: string): boolean =>
    options.edgeKinds[kind]?.ranks === true;
  const index = new Map(
    layered.nodes.flatMap((node, i) =>
      node.id === undefined ? [] : [[node.id, i] as const],
    ),
  );
  const edges = graph.edges.flatMap((edge) => {
    const from = index.get(edge.source);
    const to = index.get(edge.target);
    return ranks(edge.kind) && from !== undefined && to !== undefined
      ? [[from, to] as const]
      : [];
  });
  const comp = components(layered.nodes.length, edges);
  return layered.bundles.map((bundle) => {
    const from = index.get(bundle.source);
    const to = index.get(bundle.target);
    return (
      ranks(bundle.kind) &&
      (from === undefined || to === undefined || comp[from] !== comp[to])
    );
  });
}

/**
 * The across separations among layered nodes: each directed segment puts its lower end below its upper end by both
 * half-extents and the rank gap, and two nodes of different ranks whose in-rank extents overlap keep apart, the
 * upper one first. Every separation runs from a smaller rank to a larger one, so none forms a cycle.
 */
export function nodeSeparations(input: LevelNodeInput): Separation[] {
  return [...segmentSeparations(input), ...overlapSeparations(input)];
}

function segmentSeparations({
  layered,
  directed,
  halfAcross,
  rankGap,
}: LevelNodeInput): Separation[] {
  const { nodes } = layered;
  return layered.segments.flatMap((segment) => {
    const upper = nodes[segment.top]!.rank;
    const lower = nodes[segment.bottom]!.rank;
    if (!directed[segment.bundle]) {
      return [];
    }
    if (upper >= lower) {
      throw new Error(
        `directed segment from rank ${upper} to rank ${lower} does not descend a rank`,
      );
    }
    const gap =
      halfAcross[segment.top]! + halfAcross[segment.bottom]! + rankGap[upper]!;
    return [{ from: segment.top, to: segment.bottom, gap }];
  });
}

/**
 * Pairs of nodes of different ranks whose in-rank extents overlap. Sorted by their lower in-rank edge, each node is
 * compared only with those that start before its upper edge ends, so the scan stays near linear on sparse rows.
 */
function overlapSeparations(input: LevelNodeInput): Separation[] {
  const { layered, inRank, halfIn } = input;
  const { nodes } = layered;
  const low = (i: number): number => inRank[i]! - halfIn[i]!;
  const high = (i: number): number => inRank[i]! + halfIn[i]!;
  const order = nodes.map((_, i) => i).sort((a, b) => low(a) - low(b));
  const out: Separation[] = [];
  order.forEach((u, a) => {
    for (let b = a + 1; b < order.length; b++) {
      const v = order[b]!;
      if (low(v) >= high(u)) {
        break;
      }
      if (low(u) < high(v) && nodes[u]!.rank !== nodes[v]!.rank) {
        out.push(overlapPair(input, u, v));
      }
    }
  });
  return out;
}

/** The separation that keeps two overlapping nodes apart across the ranks, the one of the smaller rank first. */
function overlapPair(
  { layered, halfAcross, spacing }: LevelNodeInput,
  u: number,
  v: number,
): Separation {
  const [upper, lower] =
    layered.nodes[u]!.rank < layered.nodes[v]!.rank ? [u, v] : [v, u];
  const bothReal =
    layered.nodes[u]!.id !== undefined && layered.nodes[v]!.id !== undefined;
  const gap =
    halfAcross[u]! + halfAcross[v]! + (bothReal ? spacing.node : spacing.edge);
  return { from: upper, to: lower, gap };
}
