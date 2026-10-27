/**
 * The public API of @fusion-power-user/graph-layout: plain data in, plain data out. Nothing here names a consumer;
 * dbt, lineage, React and React Flow are unknown to the package.
 *
 * The engine lays out a directed graph in ranks (Sugiyama's framework): edge kinds whose policy `ranks` drive the
 * ranking; every other kind is drawn and routed but does not move a node to another rank. Ports pin an edge end to a
 * point on a node's side; clusters keep their members together; partitions order ranks in bands; hints from a
 * previous result keep an incremental expansion stable.
 */

/** A point in the drawing's own frame: x to the right, y down. */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A side of a node, in the drawing's frame. */
export type Side = "north" | "east" | "south" | "west";

export interface LayoutPort {
  /** Unique within its node. */
  id: string;
  side: Side;
  /** Distance from the side's start (its top for east and west, its left for north and south) to the port. */
  offset: number;
}

export interface LayoutNode {
  /** Unique within the graph. */
  id: string;
  width: number;
  height: number;
  /** Ports in any order; the engine keeps each at its offset, so their order on a side is fixed. */
  ports?: readonly LayoutPort[];
  /** The innermost cluster the node belongs to. */
  cluster?: string;
  /**
   * The node's band. When `LayoutOptions.partitions` is `strict`, every node of a lower partition sits in an
   * earlier rank than every node of a higher one; when `soft`, crossing a partition boundary backwards costs ranking
   * weight instead.
   */
  partition?: number;
}

export interface LayoutEdge {
  /** Unique within the graph. */
  id: string;
  source: string;
  target: string;
  /** A port id on the source node; absent attaches to the side the engine chooses. */
  sourcePort?: string;
  targetPort?: string;
  /** A key of `LayoutOptions.edgeKinds`. */
  kind: string;
}

/** A group of nodes kept contiguous within each rank and drawn inside one box. Clusters nest through `parent`. */
export interface LayoutCluster {
  id: string;
  parent?: string;
  /** Space between the box and its members, and room for a label above them. */
  padding?: number;
  labelHeight?: number;
}

export interface LayoutGraph {
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
  clusters?: readonly LayoutCluster[];
}

/** How one kind of edge takes part in each phase. */
export interface EdgeKindPolicy {
  /** The edge orders its ends in rank: source before target. */
  ranks: boolean;
  /** Smallest rank span of a ranking edge. Defaults to 1. */
  minLength?: number;
  /** Pull in ranking, ordering and placement, relative to 1. Defaults to 1. */
  weight?: number;
  /** The edge is routed and returned. Defaults to true; `false` makes a pure layout constraint. */
  routed?: boolean;
}

/** Where a previous result put each node, fed back so a grown graph keeps its shape. */
export interface LayoutHints {
  /** Rank and in-rank order of each node, and its top-left corner. */
  nodes: ReadonlyMap<
    string,
    { rank: number; order: number; x: number; y: number }
  >;
}

export interface Spacing {
  /** Between two nodes in one rank. */
  node: number;
  /** Least space between two ranks, before routing widens it. */
  rank: number;
  /** Between two parallel edge segments, and between an edge and a node. */
  edge: number;
  /** Between two cluster boxes. */
  cluster: number;
}

export interface LayoutOptions {
  /** The direction ranks run: `down` puts sources at the top, `right` at the left. */
  direction: "down" | "right";
  /** The policy of every edge kind the graph uses; an edge of another kind is an input error. */
  edgeKinds: Readonly<Record<string, EdgeKindPolicy>>;
  spacing?: Partial<Spacing>;
  /** How partitions constrain ranks. Defaults to `none`, which ignores `LayoutNode.partition`. */
  partitions?: "none" | "soft" | "strict";
  /** A node kept at the origin, such as the node a view is centred on. */
  anchor?: string;
  /** The previous result's hints; `LayoutResult.hints` is in this form. */
  hints?: LayoutHints;
  /** Weight of the hint terms against edge length: 0 uses hints only as the starting order. Defaults to 1. */
  stability?: number;
  /** How much search the ordering phase spends. Defaults to `balanced`. */
  effort?: "fast" | "balanced" | "thorough";
  /** Seed for the tie-breaking that `thorough` randomises. The result is a pure function of input and seed. */
  seed?: number;
}

export interface NodeLayout extends Rect {
  rank: number;
  order: number;
}

export interface EdgeLayout {
  /** Orthogonal polyline from the source end to the target end, bends included. */
  points: readonly Point[];
  /** The edge was laid out against its direction to keep ranking acyclic; `points` still run source to target. */
  reversed: boolean;
}

export interface LayoutMetrics {
  crossings: number;
  bends: number;
  /** Sum of the polylines' lengths. */
  edgeLength: number;
  /** Area of `bounds`. */
  area: number;
  /** Total node area over `area`, between 0 and 1. */
  density: number;
  /** Pairs of nodes, or of a node and an edge it does not end at, that overlap. Zero unless the engine has a bug. */
  overlaps: number;
}

export interface LayoutResult {
  nodes: ReadonlyMap<string, NodeLayout>;
  edges: ReadonlyMap<string, EdgeLayout>;
  clusters: ReadonlyMap<string, Rect>;
  /** One box per partition present, spanning its ranks. Empty when `partitions` is `none`. */
  partitions: readonly (Rect & { partition: number })[];
  bounds: Rect;
  /** Feed to the next `layout` call as `LayoutOptions.hints`. */
  hints: LayoutHints;
  metrics: LayoutMetrics;
}

/** A problem with the input that `layout` refuses, reported for every offending element at once. */
export interface LayoutInputIssue {
  code:
    | "duplicate-id"
    | "unknown-node"
    | "unknown-port"
    | "unknown-kind"
    | "unknown-cluster"
    | "cluster-cycle"
    | "bad-size";
  /** The node, edge, port or cluster id. */
  subject: string;
}
