/**
 * The @fusion-power-user/graph-layout adapter behind the layout-engine port. It maps a `LayoutRequest` to the
 * package's typed graph and maps the result back: cards are nodes, column rows are ports, and the dbt layer is both a
 * partition, which orders the ranks, and a cluster, whose box is the band. Clusters keep their boxes apart and widen
 * the rank gaps for their padding, so bands never overlap and edges run between them.
 */
import {
  type EdgeKindPolicy,
  type LayoutEdge,
  type LayoutGraph,
  type LayoutHints as PackageHints,
  type LayoutNode,
  type LayoutOptions,
  type LayoutResult,
  layout,
} from "@fusion-power-user/graph-layout";
import { OTHER_TAG } from "../layerTags";
import type {
  LayerBand,
  LayoutCard,
  LayoutEdgeSpec,
  LayoutEngine,
  LayoutRequest,
  LayoutResponse,
  Point,
  RoutedGeometry,
} from "./layoutEngine";

/** The classic engine's spacing, so the two engines' drawings compare card for card. */
const BAND_PAD = 22;
const CARD_GAP = 28;
const GUTTER = 36;

/** The dbt layers in flow order; a custom layer ranks between intermediate and marts, and Other after every layer. */
const LAYER_ORDER = ["source", "staging", "intermediate", "marts"];

/** Edge kinds: dependencies rank the cards; column and relationship edges are routed but never move a card. */
const EDGE_KINDS: Readonly<Record<string, EdgeKindPolicy>> = {
  table: { ranks: true },
  group: { ranks: true },
  rank: { ranks: true, routed: false },
  column: { ranks: false, weight: 0.5, sourceSide: "east", targetSide: "west" },
  relationship: { ranks: false },
};

export type GraphLayoutEffort = NonNullable<LayoutOptions["effort"]>;

/** The adapter's engine, ranks on shared rows, with the ordering search `effort` sets. */
export function graphLayoutEngine(effort: GraphLayoutEffort): LayoutEngine {
  return {
    id: "graph-layout",
    layout(request: LayoutRequest): LayoutResponse {
      const tags = layerTags(request.cards);
      const graph = toGraph(request, tags);
      const result = layout(graph, optionsFor(request, effort));
      return {
        positions: positionsOf(result),
        bands: bandsOf(result),
        edges: edgesOf(result, graph),
        hints: { engine: "graph-layout", data: result.hints },
      };
    },
  };
}

/** The package's options for one request: downward ranks, layers as soft partitions, the focus card as anchor. */
function optionsFor(
  request: LayoutRequest,
  effort: GraphLayoutEffort,
): LayoutOptions {
  const previous =
    request.previous?.engine === "graph-layout"
      ? (request.previous.data as PackageHints)
      : undefined;
  return {
    direction: "down",
    edgeKinds: EDGE_KINDS,
    partitions: "soft",
    ranks: "rows",
    anchor: request.focus,
    effort,
    spacing: { node: CARD_GAP, rank: GUTTER, edge: 6, cluster: CARD_GAP },
    ...(previous ? { hints: previous } : {}),
  };
}

/** The request as the package's graph. A ranking pair with no drawn edge still ranks, through an unrouted edge. */
function toGraph(request: LayoutRequest, tags: readonly string[]): LayoutGraph {
  const nodes: LayoutNode[] = request.cards.map((card) => nodeOf(card, tags));
  const edges: LayoutEdge[] = request.edges.map((edge) => edgeOf(edge));
  const drawn = new Set(
    request.edges
      .filter((edge) => edge.role === "table" || edge.role === "group")
      .map((edge) => `${edge.from}\u0000${edge.to}`),
  );
  request.rankPairs.forEach(([parent, child], index) => {
    if (!drawn.has(`${parent}\u0000${child}`)) {
      edges.push({
        id: `rank:${index}`,
        source: parent,
        target: child,
        kind: "rank",
      });
    }
  });
  const clusters = [
    ...tags
      .filter((tag) => tag !== OTHER_TAG)
      .map((tag) => ({ id: tag, padding: BAND_PAD })),
    ...request.cards
      .filter((card) => card.tag === OTHER_TAG)
      .map((card) => ({ id: otherCluster(card), padding: BAND_PAD })),
  ];
  return { nodes, edges, clusters };
}

/** The cluster of a card in Other: its own, so Other cards sit wherever their edges put them, each in a small band. */
const otherCluster = (card: LayoutCard): string => `${OTHER_TAG}:${card.id}`;

/**
 * A card as a node in its layer's partition and cluster; its column rows become east and west ports at their offsets.
 * A card in Other has no partition, so the layer order does not move it, and a cluster of its own.
 */
function nodeOf(card: LayoutCard, tags: readonly string[]): LayoutNode {
  const ports = (card.rows ?? []).flatMap((row) => [
    { id: `out:${row.id}`, side: "east" as const, offset: row.offset },
    { id: `in:${row.id}`, side: "west" as const, offset: row.offset },
  ]);
  const other = card.tag === OTHER_TAG;
  return {
    id: card.id,
    width: card.width,
    height: card.height,
    ...(other ? {} : { partition: tags.indexOf(card.tag) }),
    cluster: other ? otherCluster(card) : card.tag,
    ...(ports.length > 0 ? { ports } : {}),
  };
}

/**
 * The request's layer tags in partition order: the known layers in flow order, then custom layers by name before
 * marts' successors, then Other. A partition is a tag's index here.
 */
function layerTags(cards: readonly LayoutCard[]): string[] {
  const present = new Set(cards.map((card) => card.tag));
  const custom = [...present]
    .filter((tag) => tag !== OTHER_TAG && !LAYER_ORDER.includes(tag))
    .toSorted();
  const known = (tags: readonly string[]) =>
    tags.filter((tag) => present.has(tag));
  return [
    ...known(LAYER_ORDER.slice(0, -1)),
    ...custom,
    ...known(LAYER_ORDER.slice(-1)),
    ...(present.has(OTHER_TAG) ? [OTHER_TAG] : []),
  ];
}

/** An edge spec as a typed edge; a column edge names its row ports when both cards list the row. */
function edgeOf(edge: LayoutEdgeSpec): LayoutEdge {
  const base = {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    kind: edge.role,
  };
  if (edge.role !== "column") {
    return base;
  }
  return {
    ...base,
    ...(edge.fromRow === undefined
      ? {}
      : { sourcePort: `out:${edge.fromRow}` }),
    ...(edge.toRow === undefined ? {} : { targetPort: `in:${edge.toRow}` }),
  };
}

/** Each card's top-left corner. */
function positionsOf(result: LayoutResult): Map<string, Point> {
  return new Map(
    Array.from(result.nodes, ([id, rect]) => [id, { x: rect.x, y: rect.y }]),
  );
}

/** One band per cluster box, which already holds its padding: a layer's, or one Other card's, labelled Other. */
function bandsOf(result: LayoutResult): LayerBand[] {
  return Array.from(result.clusters, ([id, box]) => ({
    tag: id.startsWith(`${OTHER_TAG}:`) ? OTHER_TAG : id,
    ...box,
  }));
}

/** Every routed edge's polyline, which the package runs from the source card, so the source is where it starts. */
function edgesOf(
  result: LayoutResult,
  graph: LayoutGraph,
): Map<string, RoutedGeometry> {
  const sourceOf = new Map(graph.edges.map((edge) => [edge.id, edge.source]));
  const edges = new Map<string, RoutedGeometry>();
  for (const [id, edge] of result.edges) {
    edges.set(id, { points: edge.points, startsAt: sourceOf.get(id) });
  }
  return edges;
}
