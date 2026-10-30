// The layered graph: its nodes, the bundles that carry edges across ranks, and the segments of those bundles.

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

/**
 * The stable key of a dummy: the edge (or cluster) it stands for, its rank, and its position in the chain it belongs
 * to, counted from the upper end. A bundle's chain is keyed by its first member edge, a cluster spine by its cluster.
 * No two dummies share a key, and a key does not change when an unrelated edge is added.
 */
export interface DummyKey {
  /** Whether `owner` is an edge id or a cluster id. */
  kind: "edge" | "cluster";
  owner: string;
  rank: number;
  position: number;
}

/** A node of the layered graph: a real node, or a dummy that carries one bundle across an intermediate rank. */
export interface LayeredNode {
  /** The node's id, or `undefined` for a dummy. */
  id: string | undefined;
  rank: number;
  /** Extent along the in-rank axis: the node's size, or a dummy's member count times the edge spacing. */
  breadth: number;
  /** Set on the dummy of a lateral port; absent for every other dummy and real node. */
  port?: PortDummy;
  /** Set on every dummy; absent on a real node. */
  key?: DummyKey;
}

/** The edges of one kind between one ordered pair of nodes, drawn as one chain of dummies. */
export interface Bundle {
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
export interface Segment {
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
  /**
   * The cluster chain of each layered node's block, outermost cluster first, as indices into `graph.clusters`. A dummy
   * outside every cluster, and a node in none, has an empty chain.
   */
  paths: number[][];
  /** Number of ranks, from 0 up to the highest rank. */
  ranks: number;
  /**
   * The spine of each cluster gap: the layered nodes it runs through, from the upper member down to the lower one,
   * dummies included. Placement keeps each spine straight; ordering keeps its dummies inside their cluster.
   */
  spines: number[][];
}
