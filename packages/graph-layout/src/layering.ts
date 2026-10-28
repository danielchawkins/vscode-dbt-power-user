import { groupBundles } from "./bundles.js";
import { lateralPort } from "./lateral.js";
import {
  TOWARD_LOWER,
  TOWARD_UPPER,
  inRankExtent,
  meanPortOffset,
} from "./offsets.js";
import type { RankResult } from "./rank/index.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "./types.js";

/** Space between two parallel edges, used when `LayoutOptions.spacing` leaves it out. */
const DEFAULT_EDGE_SPACING = 4;

/**
 * The port a dummy stands for: it sits in its owner's rank, beside the owner, and the bundle's edge leaves the owner's
 * side at the port's offset and runs to the dummy.
 */
export interface PortDummy {
  /** Layered index of the owner, a real node in the same rank. */
  owner: number;
  /** Whether the dummy lies after the owner in the in-rank order (east, or south when ranks run right). */
  after: boolean;
  /** Whether the run goes toward the band below the rank (an upper end, or a flat bundle), else from above. */
  below: boolean;
  /** The port's offset from the start of its side, as in `LayoutPort`. */
  offset: number;
  /** Routed member edges, each with its own stub and run; zero for a kind that is not routed. */
  runs: number;
}

/** A node of the layered graph: a real node, or a dummy that carries one bundle across an intermediate rank. */
interface LayeredNode {
  /** The node's id, or `undefined` for a dummy. */
  id: string | undefined;
  rank: number;
  /** Extent along the in-rank axis: the node's size, or a dummy's member count times the edge spacing. */
  breadth: number;
  /** Set on the dummy of a lateral port; absent for every other dummy and real node. */
  port?: PortDummy;
}

/** The edges of one kind between one ordered pair of nodes, drawn as one chain of dummies. */
interface Bundle {
  kind: string;
  source: string;
  target: string;
  /** Ids of the member edges, in input order. */
  edges: string[];
  /** Layered indices from the upper rank to the lower one, dummies included; a flat bundle holds its two ends. */
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
  /**
   * The block of each layered node: the index of its owner when it is a lateral port's dummy, otherwise its own index.
   * A block is kept contiguous in every rank, so an owner and its port dummies are ordered as one unit.
   */
  block: number[];
  /** Number of ranks, from 0 up to the highest rank. */
  ranks: number;
}

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
 * bundle spans, and a port dummy for each lateral port end. Self-loops take no part. A port counts towards its end's
 * offset only on the side that faces the adjacent rank.
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
  for (const members of groupBundles(graph, options.direction)) {
    addBundle(build, members);
  }
  return {
    nodes: build.nodes,
    bundles: build.bundles,
    segments: build.segments,
    block: build.nodes.map((node, x) => node.port?.owner ?? x),
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
  const ends = {
    count: members.length,
    runs: options.edgeKinds[first.kind]?.routed === false ? 0 : members.length,
  };
  const top = endNode(build, {
    node: upper,
    port: reversed ? first.targetPort : first.sourcePort,
    below: true,
    ...ends,
  });
  const bottom = endNode(build, {
    node: lower,
    port: reversed ? first.sourcePort : first.targetPort,
    below: bundle.flat,
    ...ends,
  });
  if (bundle.flat) {
    bundle.chain = [top, bottom];
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
  const chain = [top];
  const width = Math.max(1, members.length) * build.spacing;
  for (let r = rank[upper]! + 1; r < rank[lower]!; r++) {
    chain.push(build.nodes.length);
    build.nodes.push({ id: undefined, rank: r, breadth: width });
  }
  chain.push(bottom);
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

/**
 * The node standing for one end of a bundle: a port dummy in the end's rank when the port is lateral, else the end node.
 */
function endNode(
  build: Build,
  end: {
    node: number;
    port: string | undefined;
    below: boolean;
    count: number;
    runs: number;
  },
): number {
  const { node, below, count, runs } = end;
  const lateral = lateralPort(
    build.graph.nodes[node],
    end.port,
    build.options.direction,
  );
  if (lateral === undefined) {
    return node;
  }
  build.nodes.push({
    id: undefined,
    rank: build.rank[node]!,
    breadth: Math.max(1, count) * build.spacing,
    port: {
      owner: node,
      after: lateral.after,
      below,
      offset: lateral.port.offset,
      runs,
    },
  });
  return build.nodes.length - 1;
}
