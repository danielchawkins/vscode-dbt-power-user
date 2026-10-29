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

/** A side of a node, in the drawing's frame: north is the top, east the right, whatever `direction` is. */
export type Side = "north" | "east" | "south" | "west";

export interface LayoutPort {
  /** Unique within its node. */
  id: string;
  /** The side of the node the port sits on; an edge that names the port leaves or enters the node there. */
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
   * The node's band. When `LayoutOptions.partitions` is `strict`, every node of a lower partition sits in an earlier
   * rank than every node of a higher one; when `soft` (the default), crossing a partition boundary backwards costs
   * ranking weight instead. A node with no partition is in no band under `soft`, so its edges alone rank it; under
   * `strict` it is in the first band.
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
  /**
   * The side the edge leaves its source on, for an edge that names no `sourcePort`. Omitted, the engine picks the
   * side that faces the target in `direction`. A port's own side wins over this.
   */
  sourceSide?: Side;
  /** The side the edge enters its target on, for an edge that names no `targetPort`. Omitted, as for `sourceSide`. */
  targetSide?: Side;
}

/**
 * Where a previous result put each node, fed back so a grown graph keeps its shape. Ranks are reproduced exactly. The
 * in-rank order of real nodes is reproduced for route graphs and not always for clustered ones, and positions are
 * reproduced only where the layered order, dummies included, repeats: `LayoutHints` carries no dummy order. See README,
 * "Hints", for the measured bounds.
 */
export interface LayoutHints {
  /** Rank and in-rank order of each node (its index among the real nodes of its rank), and its top-left corner. */
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
  /**
   * How partitions constrain ranks. `none` ignores `LayoutNode.partition`; `soft` penalises a backward crossing of a
   * partition boundary; `strict` forbids it. Defaults to `soft`.
   */
  partitions?: "none" | "soft" | "strict";
  /**
   * How the across axis is drawn. `rows` (the default) stacks each rank as one shared row. `levels` gives each node its
   * rank's level as a desired position, but pushes it below the nodes its ranking edges place above it, so ancestors
   * sit at distinct heights and the nodes of one rank may sit at different ones.
   */
  ranks?: "rows" | "levels";
  /** A node kept at the origin, such as the node a view is centred on. */
  anchor?: string;
  /** The previous result's hints; `LayoutResult.hints` is in this form. See `LayoutHints` for what they reproduce. */
  hints?: LayoutHints;
  /** Weight of the hint terms against edge length: 0 uses hints only as the starting order. Defaults to 1. */
  stability?: number;
  /** How much search the ordering phase spends. Defaults to `balanced`. */
  effort?: "fast" | "balanced" | "thorough";
  /** Seed for the tie-breaking that `thorough` randomises. The result is a pure function of input and seed. */
  seed?: number;
}

export interface NodeLayout extends Rect {
  /** The rank the node is in, as ranking set it, lowest real node at 0. */
  rank: number;
  /** The node's index among the real nodes of its rank, in drawing order: dummies are not counted. */
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
  /**
   * Pairs of nodes, or of a node and an edge it does not end at, that overlap. Zero under `ranks: "rows"`. Under
   * `ranks: "levels"` node pairs still never overlap, but an edge can pass through a node it does not end at (README,
   * "Guarantees").
   */
  overlaps: number;
}

export interface LayoutResult {
  nodes: ReadonlyMap<string, NodeLayout>;
  /**
   * Every routed edge, by id. Absent: the edges of a kind with `routed: false`, and self-loops, which are not drawn yet.
   */
  edges: ReadonlyMap<string, EdgeLayout>;
  clusters: ReadonlyMap<string, Rect>;
  /** One box per partition some node sets: the bounding box of its members' rects. Empty when `partitions` is `none` or no node sets one. */
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
    | "bad-size"
    | "bad-side"
    | "bad-offset";
  /** The node, edge, port or cluster id. */
  subject: string;
}
