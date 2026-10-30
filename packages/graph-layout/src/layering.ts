import { groupBundles } from "./bundles.js";
import { clusterChains } from "./clusters.js";
import { indexed } from "./indexed.js";
import { lateralPort } from "./lateral.js";
import {
  type Bundle,
  type LayeredGraph,
  type LayeredNode,
  type Segment,
} from "./layeredGraph.js";
import {
  TOWARD_LOWER,
  TOWARD_UPPER,
  inRankExtent,
  meanPortOffset,
} from "./offsets.js";
import type { RankResult } from "./rank/index.js";
import { addSpineDummies, spinesOf } from "./spines.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "./types.js";

export type { LayeredGraph, PortDummy } from "./layeredGraph.js";

/** Space between two parallel edges, used when `LayoutOptions.spacing` leaves it out. */
const DEFAULT_EDGE_SPACING = 4;

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
    index: indexed(graph).nodeIndex,
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
  const block = build.nodes.map((node, x) => node.port?.owner ?? x);
  const paths = clusterChains(
    graph,
    block.map((owner) => build.nodes[owner]!.id),
  );
  const spines = addSpineDummies(
    build.nodes,
    spinesOf(
      graph,
      build.nodes.map((node) => node.rank),
      paths,
    ),
  );
  return {
    nodes: build.nodes,
    bundles: build.bundles,
    segments: build.segments,
    block: build.nodes.map((node, x) => node.port?.owner ?? x),
    paths: [...paths, ...spines.paths],
    spines: spines.spines,
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
    keyChain(build, first.id, bundle.chain);
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
  keyChain(build, first.id, chain);
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
 * Gives each dummy of a bundle's chain its key: the bundle's first member edge, the dummy's rank, and its position in
 * the chain. The chain's real ends have no key, since they are real nodes.
 */
function keyChain(build: Build, edge: string, chain: readonly number[]): void {
  chain.forEach((x, position) => {
    const node = build.nodes[x]!;
    if (node.id === undefined) {
      node.key = { kind: "edge", owner: edge, rank: node.rank, position };
    }
  });
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
