import type { Point } from "./layeredMetrics";

export interface RouteInput {
  focus: string;
  boxes: ReadonlyMap<string, RouteBox>;
  /** Sub-row index of every card, counted from the top. */
  rowOf: ReadonlyMap<string, number>;
  /** Generation of every card from the start node, used to tell a one-generation step from a longer span. */
  generation: ReadonlyMap<string, number>;
  /** Horizontal extent of the layered (non-Other) cards. */
  layeredBounds: { left: number; right: number };
  tableRoutes: readonly TableRoute[];
  columnRoutes: readonly ColumnRoute[];
  relationshipRoutes: readonly RelationshipRoute[];
  /** A column trace is shown: table edges then never hop, and crossings with them count a tenth. */
  traceOn: boolean;
}

export interface RouteResult {
  paths: Map<string, RoutedPath>;
  crossings: number;
  hops: number;
}

export interface RoutedPath {
  d: string;
  /** The middle of the path's longest run, where a label sits. */
  labelAt: Point;
  /** The first and last points of the path: the card edges it leaves and enters. */
  start: Point;
  end: Point;
  /** A relationship's path: the card it starts at, which is its upper card, or `from` when both share a row. */
  startsAt?: string | undefined;
}

/** A dbt edge: the parent's child bubble to the child's parent bubble. */
export interface TableRoute {
  id: string;
  parent: string;
  child: string;
}

/** A column edge, leaving the source card on its right and entering the target card on its left. */
export interface ColumnRoute {
  id: string;
  from: string;
  fromY: number;
  to: string;
  toY: number;
}

/** A declared relationship between two cards, joined through the left part of their top or bottom edge. */
export interface RelationshipRoute {
  id: string;
  from: string;
  to: string;
}

export interface RouteBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
