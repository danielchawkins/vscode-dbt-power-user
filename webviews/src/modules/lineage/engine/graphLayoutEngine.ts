import {
  decodeLayout,
  type EdgeKindPolicy,
  encodeGraph,
  type LayoutEdge,
  type LayoutGraph,
  type LayoutHints as PackageHints,
  type LayoutNode,
  type LayoutOptions,
  type LayoutResult,
  layout,
  type Spacing,
} from "@fusion-power-user/graph-layout";
/**
 * The @fusion-power-user/graph-layout adapter behind the layout-engine port. It maps a `LayoutRequest` to the
 * package's typed graph and maps the result back: cards are nodes, column rows are ports, and the dbt layer is both a
 * partition, which orders the ranks, and a cluster, whose box is the band. Clusters keep their boxes apart and widen
 * the rank gaps for their padding, so bands never overlap and edges run between them.
 */
import { lineage } from "@fusion-power-user/webview-contract";
import { OTHER_TAG } from "../layerTags";
import {
  isSuperseded,
  type LayerBand,
  type LayoutAnswer,
  type LayoutCard,
  type LayoutEdgeSpec,
  type LayoutEngine,
  type LayoutRequest,
  type LayoutResponse,
  type Point,
  type RoutedGeometry,
} from "./layoutEngine";

/** The card spacing the panel draws with: the band padding, the gap between cards and the gutter their edges route through. */
const BAND_PAD = 22;
const CARD_GAP = 28;
const GUTTER = 36;

/**
 * The layout spacing each preset gives: `node` between cards in one rank, `rank` between ranks, `edge` between parallel
 * edge segments, `cluster` between layer boxes. Compact is about two thirds of default in each setting, so cards and
 * their gaps keep their proportions.
 */
const SPACING: Readonly<Record<lineage.SpacingPreset, Spacing>> = {
  default: { node: CARD_GAP, rank: GUTTER, edge: 6, cluster: CARD_GAP },
  compact: { node: 18, rank: 24, edge: 4, cluster: 18 },
};

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

/**
 * The hint kind: a pull without a drawn edge. Offered only to a request that draws a hint: the engine's layouts
 * change when a kind it does not use is offered, so the other requests keep the kinds they always had.
 */
const HINT_KIND: EdgeKindPolicy = { ranks: false, routed: false, weight: 0.5 };

/**
 * The soft kind: a dependency of a softened card, drawn and routed, pulling at a low weight and ranking nothing. It is
 * offered only to a request that has one, for the same reason as the hint kind.
 */
const SOFT_KIND: EdgeKindPolicy = { ranks: false, weight: 0.2 };

/** The edge kinds a request is laid out with. */
function edgeKindsOf(
  request: LayoutRequest,
): Readonly<Record<string, EdgeKindPolicy>> {
  const kinds = { ...EDGE_KINDS };
  if (request.edges.some((edge) => edge.role === "hint")) {
    kinds.hint = HINT_KIND;
  }
  if (request.edges.some((edge) => edge.role === "soft")) {
    kinds.soft = SOFT_KIND;
  }
  return kinds;
}

export type GraphLayoutEffort = NonNullable<LayoutOptions["effort"]>;

/** The adapter's engine, ranks on shared rows, with the ordering search `effort` sets. */
export function graphLayoutEngine(effort: GraphLayoutEffort): LayoutEngine {
  return {
    id: "graph-layout",
    layout(request: LayoutRequest, generation: number): Promise<LayoutAnswer> {
      const graph = graphOf(request);
      const response = responseOf(
        layout(graph, optionsFor(request, effort)),
        graph,
      );
      return Promise.resolve(
        isSuperseded(generation)
          ? { superseded: true }
          : { superseded: false, response },
      );
    },
  };
}

/** The request as the package's graph, with its layer tags in partition order. */
function graphOf(request: LayoutRequest): LayoutGraph {
  return toGraph(request, layerTags(request.cards));
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
    edgeKinds: edgeKindsOf(request),
    partitions: "soft",
    ranks: "rows",
    anchor: request.focus,
    effort,
    spacing: SPACING[request.spacing ?? lineage.DEFAULT_SPACING_PRESET],
    ...(previous ? { hints: previous } : {}),
  };
}

/** The panel's answer for a laid-out `graph`: cards, bands, routed edges, hints and measures. */
function responseOf(result: LayoutResult, graph: LayoutGraph): LayoutResponse {
  return {
    positions: positionsOf(result),
    bands: bandsOf(result),
    edges: edgesOf(result, graph),
    hints: { engine: "graph-layout", data: result.hints },
    metrics: {
      crossings: result.metrics.crossings,
      bends: result.metrics.bends,
      edgeLength: result.metrics.edgeLength,
      area: result.metrics.area,
    },
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
  // A layer's band is transparent: edges between layers cross the bands in between. A card in Other is a wall around
  // itself, so no edge runs through it.
  const clusters = [
    ...tags
      .filter((tag) => tag !== OTHER_TAG)
      .map((tag) => ({ id: tag, padding: BAND_PAD, opaque: false })),
    ...request.cards
      .filter((card) => card.tag === OTHER_TAG)
      .map((card) => ({
        id: otherCluster(card),
        padding: BAND_PAD,
        opaque: true,
      })),
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

/**
 * Every routed edge's polyline, which the package runs from the source card, so the source is where it starts. An edge
 * the engine flagged `routeFailed` has no polyline and is left out: the panel draws it unrouted, never invented.
 */
function edgesOf(
  result: LayoutResult,
  graph: LayoutGraph,
): Map<string, RoutedGeometry> {
  const sourceOf = new Map(graph.edges.map((edge) => [edge.id, edge.source]));
  const edges = new Map<string, RoutedGeometry>();
  for (const [id, edge] of result.edges) {
    if (!edge.routeFailed) {
      edges.set(id, { points: edge.points, startsAt: sourceOf.get(id) });
    }
  }
  return edges;
}

/** Sends a layout to the host and resolves to its answer: the layout frame, or `superseded`. */
export type LayoutTransport = (
  params: lineage.LayoutParams,
) => Promise<lineage.LayoutBody>;

/** The Rust engine's hints are columns, one per field, where the package's are a map keyed by node. */
interface ColumnarHints {
  id: string[];
  rank: number[];
  order: number[];
  x: number[];
  y: number[];
}

/** The options as the Rust engine reads them. */
type WireOptions = Omit<LayoutOptions, "hints"> & {
  hints?: ColumnarHints | undefined;
};

/** The options as JSON the engine reads: the package's options, with the previous hints in columns. */
function wireOptions({ hints, ...options }: LayoutOptions): WireOptions {
  if (hints === undefined) {
    return options;
  }
  const nodes = [...hints.nodes];
  return {
    ...options,
    hints: {
      id: nodes.map(([id]) => id),
      rank: nodes.map(([, hint]) => hint.rank),
      order: nodes.map(([, hint]) => hint.order),
      x: nodes.map(([, hint]) => hint.x),
      y: nodes.map(([, hint]) => hint.y),
    },
  };
}

/**
 * The Rust engine for `effort`: the same package graph and options as the TypeScript engine, laid out in the host
 * through `transport`. The transport is the one thing that differs: the layout runs in the host, not in the webview.
 */
export function rustLayoutEngine(
  effort: GraphLayoutEffort,
  transport: LayoutTransport,
): LayoutEngine {
  return {
    id: "graph-layout",
    async layout(
      request: LayoutRequest,
      generation: number,
    ): Promise<LayoutAnswer> {
      const graph = graphOf(request);
      const body = await transport({
        frame: encodeGraphFrame(graph),
        options: JSON.stringify(wireOptions(optionsFor(request, effort))),
        generation,
      });
      if (body.superseded || isSuperseded(generation)) {
        return { superseded: true };
      }
      return {
        superseded: false,
        response: responseOf(decodeLayoutFrame(body.frame), graph),
      };
    },
  };
}

/** The bytes per `String.fromCharCode` call, so a large frame does not overflow the argument list. */
const CHUNK = 0x8000;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/**
 * The graph frame the host's Rust engine reads, as base64 text, since a webview message is JSON. The codec is the
 * package's `frame.ts`, which the Rust core matches byte for byte; this adapter is the only webview module that calls it.
 */
const encodeGraphFrame = (graph: LayoutGraph): string =>
  toBase64(encodeGraph(graph));

/** The layout a host answered as base64 text: the same result the TypeScript engine returns. */
const decodeLayoutFrame = (text: string): LayoutResult =>
  decodeLayout(fromBase64(text));
