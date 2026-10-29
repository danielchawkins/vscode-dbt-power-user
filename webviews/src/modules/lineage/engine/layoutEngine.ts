/**
 * The lineage panel's layout-engine port: what the panel asks of any engine, and what every engine answers. The
 * panel builds one `LayoutRequest` from its flow input (layoutRequest.ts), asks the engine `engines.ts` selects, and
 * draws the answer; it never imports an engine's modules. Adapters: ownedEngine.ts (the layered layout and gutter
 * router) and graphLayoutEngine.ts (@fusion-power-user/graph-layout).
 *
 * Plain data only, so the evaluation harness drives every engine the same way and compares their answers.
 */

/** Top-left corner of a card, or a point of an edge's path, in canvas pixels. */
export interface Point {
  x: number;
  y: number;
}

/** A dbt layer band drawn behind its cards. */
export interface LayerBand {
  tag: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A column row of a card: where a column edge joins it. */
export interface LayoutRow {
  /** The column name, as the column edge ids use it. */
  id: string;
  /** From the card's top to the row's centre line. */
  offset: number;
}

export interface LayoutCard {
  id: string;
  width: number;
  height: number;
  /** The card's dbt layer tag; a group's is its dominant tag, decided before the request is built. */
  tag: string;
  /** Listed column rows, top to bottom. */
  rows?: readonly LayoutRow[] | undefined;
}

/**
 * What an edge is. `table` and `group` are dbt dependencies, `column` joins two column rows, `relationship` is a
 * declared relationship such as a foreign key, drawn and routed but never ranking.
 */
type EdgeRole = "table" | "group" | "column" | "relationship";

export interface LayoutEdgeSpec {
  /** The id `toEdges` gives the drawn edge (edgeIds.ts), so the drawn edge finds its path. */
  id: string;
  from: string;
  to: string;
  role: EdgeRole;
  /** For a column edge: the row ids at each end. */
  fromRow?: string | undefined;
  toRow?: string | undefined;
}

/** An engine's own memory of its last answer, handed back with the next request. Opaque to the panel. */
interface LayoutHints {
  readonly engine: LayoutEngineId;
  readonly data: unknown;
}

export interface LayoutRequest {
  /** The start card, which stays where it was while the view grows. */
  focus: string;
  cards: readonly LayoutCard[];
  /** Every edge to route. */
  edges: readonly LayoutEdgeSpec[];
  /** The `[parent, child]` pairs that rank the cards, drawn or not. */
  rankPairs: readonly (readonly [string, string])[];
  /** A column trace is shown, so column edges take precedence over table edges. */
  traceOn: boolean;
  /** The previous answer's hints for this start card, if any. */
  previous?: LayoutHints | undefined;
}

export interface RoutedGeometry {
  /** Orthogonal polyline from the edge's first card to its last; the panel rounds the corners and draws the hops. */
  points: readonly Point[];
  /** A relationship's first card, which its path starts at. */
  startsAt?: string | undefined;
}

export interface LayoutResponse {
  positions: ReadonlyMap<string, Point>;
  bands: readonly LayerBand[];
  /** One entry per routed edge id; an edge left out is not drawn. */
  edges: ReadonlyMap<string, RoutedGeometry>;
  hints: LayoutHints;
}

type LayoutEngineId = "owned" | "graph-layout";

/** A layout engine: pure and synchronous, with no DOM, React or React Flow. */
export interface LayoutEngine {
  readonly id: LayoutEngineId;
  layout(request: LayoutRequest): LayoutResponse;
}
