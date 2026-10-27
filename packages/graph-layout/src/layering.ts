import type { RankResult } from "./rank/index.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  Side,
} from "./types.js";

/** Space between two parallel edges, used when `LayoutOptions.spacing` leaves it out. */
const DEFAULT_EDGE_SPACING = 4;

/** A node of the layered graph: a real node, or a dummy that carries one bundle across an intermediate rank. */
interface LayeredNode {
  /** The node's id, or `undefined` for a dummy. */
  id: string | undefined;
  rank: number;
  /** Extent along the in-rank axis: the node's size, or a dummy's member count times the edge spacing. */
  breadth: number;
}

/** The edges of one kind between one ordered pair of nodes, drawn as one chain of dummies. */
interface Bundle {
  kind: string;
  source: string;
  target: string;
  /** Ids of the member edges, in input order. */
  edges: string[];
  /**
   * Layered node indices from the upper rank to the lower one, dummies included. A flat bundle holds its source and
   * target only.
   */
  chain: number[];
  /** The ranks run against the edge: the target sits in the upper rank. */
  reversed: boolean;
  /** Both ends share a rank. A flat bundle has no dummies and is routed in the channel beside its rank. */
  flat: boolean;
  /** The kind's weight times the square root of the member count. */
  weight: number;
}

/** One link of a bundle's chain, between two adjacent ranks. */
interface Segment {
  /** Index into `LayeredGraph.bundles`. */
  bundle: number;
  /** Layered node indices of the link's upper and lower ends. */
  top: number;
  bottom: number;
  weight: number;
  /**
   * Port offset of each end, from the node's centre along the in-rank axis; zero at a dummy or where no port faces the
   * adjacent rank.
   */
  topOffset: number;
  bottomOffset: number;
}

export interface LayeredGraph {
  /** Real nodes first, in input order, then dummies. */
  nodes: LayeredNode[];
  bundles: Bundle[];
  segments: Segment[];
  /** Number of ranks, from 0 up to the highest rank. */
  ranks: number;
}

/** The side of a node that faces the next rank, and the side that faces the previous one, for each direction. */
const TOWARD_LOWER: Record<LayoutOptions["direction"], Side> = {
  down: "south",
  right: "east",
};
const TOWARD_UPPER: Record<LayoutOptions["direction"], Side> = {
  down: "north",
  right: "west",
};

/** The state a layering pass builds: the nodes, bundles and segments so far, and the ranks and indices they use. */
interface Build {
  graph: LayoutGraph;
  options: LayoutOptions;
  /** Rank of each real node, by its index in `graph.nodes`. */
  rank: number[];
  /** Index in `graph.nodes` of each real node, by id. */
  index: ReadonlyMap<string, number>;
  nodes: LayeredNode[];
  bundles: Bundle[];
  segments: Segment[];
  spacing: number;
}

/**
 * Lays the graph out in ranks: one bundle per kind and ordered pair of nodes, with a dummy chain across each rank the
 * bundle spans. Self-loops take no part. A port counts towards its end's offset only when it sits on the side that
 * faces the adjacent rank, because only that side's offset runs along the in-rank axis.
 */
export function layer(
  graph: LayoutGraph,
  options: LayoutOptions,
  ranking: RankResult,
): LayeredGraph {
  const rank = graph.nodes.map((node) => ranking.ranks.get(node.id) ?? 0);
  const build: Build = {
    graph,
    options,
    rank,
    index: new Map(graph.nodes.map((node, i) => [node.id, i] as const)),
    nodes: graph.nodes.map((node, i) => ({
      id: node.id,
      rank: rank[i]!,
      breadth: inRankExtent(node, options.direction),
    })),
    bundles: [],
    segments: [],
    spacing: options.spacing?.edge ?? DEFAULT_EDGE_SPACING,
  };
  for (const members of groupBundles(graph.edges)) {
    addBundle(build, members);
  }
  return {
    nodes: build.nodes,
    bundles: build.bundles,
    segments: build.segments,
    ranks: build.nodes.reduce((high, node) => Math.max(high, node.rank + 1), 0),
  };
}

/** Adds the bundle of one group of parallel edges and, unless it is flat, the dummy chain that carries it. */
function addBundle(build: Build, members: readonly LayoutEdge[]): void {
  const { graph, options, rank } = build;
  const first = members[0]!;
  const source = build.index.get(first.source) ?? 0;
  const target = build.index.get(first.target) ?? 0;
  const reversed = rank[source]! > rank[target]!;
  const upper = reversed ? target : source;
  const lower = reversed ? source : target;
  const bundle: Bundle = {
    kind: first.kind,
    source: first.source,
    target: first.target,
    edges: members.map((e) => e.id),
    chain: [],
    reversed,
    flat: rank[upper] === rank[lower],
    weight:
      (options.edgeKinds[first.kind]?.weight ?? 1) * Math.sqrt(members.length),
  };
  build.bundles.push(bundle);
  if (bundle.flat) {
    bundle.chain = [source, target];
    return;
  }
  const b = build.bundles.length - 1;
  const upperOffset = meanPortOffset(members, reversed ? "target" : "source", {
    node: graph.nodes[upper]!,
    breadth: build.nodes[upper]!.breadth,
    side: TOWARD_LOWER[options.direction],
  });
  const lowerOffset = meanPortOffset(members, reversed ? "source" : "target", {
    node: graph.nodes[lower]!,
    breadth: build.nodes[lower]!.breadth,
    side: TOWARD_UPPER[options.direction],
  });
  const chain = [upper];
  const width = Math.max(1, members.length) * build.spacing;
  for (let r = rank[upper]! + 1; r < rank[lower]!; r++) {
    chain.push(build.nodes.length);
    build.nodes.push({ id: undefined, rank: r, breadth: width });
  }
  chain.push(lower);
  bundle.chain = chain;
  for (let k = 0; k + 1 < chain.length; k++) {
    build.segments.push({
      bundle: b,
      top: chain[k]!,
      bottom: chain[k + 1]!,
      weight: bundle.weight,
      topOffset: k === 0 ? upperOffset : 0,
      bottomOffset: k + 2 === chain.length ? lowerOffset : 0,
    });
  }
}

/** The non-self-loop edges, grouped by kind and ordered pair of nodes, in order of first appearance. */
function groupBundles(edges: readonly LayoutEdge[]): LayoutEdge[][] {
  const groups = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    if (e.source === e.target) {
      continue;
    }
    const key = JSON.stringify([e.kind, e.source, e.target]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [e]);
    } else {
      group.push(e);
    }
  }
  return [...groups.values()];
}

/** The node's extent along the in-rank axis: its width when ranks run down, its height when they run right. */
function inRankExtent(
  node: LayoutNode,
  direction: LayoutOptions["direction"],
): number {
  return direction === "down" ? node.width : node.height;
}

/**
 * The mean offset, from the node's centre, of the port that each member names at one end. A member that names no
 * port, or a port on another side, contributes zero.
 */
function meanPortOffset(
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
