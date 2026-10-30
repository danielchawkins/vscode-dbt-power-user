/**
 * The columnar frame: the boundary encoding of a `LayoutGraph` and of a `LayoutResult` (ADR 0011, Decision 6). The Rust
 * core reads and writes the same bytes (`crates/graph-layout/src/model/frame.rs`). `frame.test.ts` and the committed
 * fixture `crates/graph-layout/fixtures/parity/frame.txt` keep the two in step.
 *
 * The codec lives here, beside the `types.ts` it encodes, so the two sides of the boundary change together.
 *
 * Every number is little-endian:
 *
 * - a header: the magic `GLFR`, the version as a `u32` (1), and the kind as a `u32` (1 graph, 2 layout);
 * - the blob: its length as a `u32`, then the UTF-8 bytes of every text, in column order;
 * - the columns, in the fixed order of the kind. A column is a tag byte (1 `u8`, 2 `u32`, 3 `f64`, 4 text), its row
 *   count as a `u32`, then its values. A text column holds `rows + 1` `u32` offsets into the blob, and row r is the
 *   bytes from offset r to offset r + 1.
 *
 * An optional text or number is a presence column (`u8`, 0 or 1) and then its column, where an absent value is an
 * empty text or zero. An optional boolean is one `u8` column: 0 absent, 1 false, 2 true. A boolean is a `u8` of 0 or
 * 1. The rows of one table share a count, and `edges.pointStart` has one row more than there are edges.
 *
 * Decoding gives back what `types.ts` can hold. A port whose node is not in the frame is an error, because a port
 * belongs to a node in the TypeScript model. An empty `ports` or `clusters` list is left out, as an absent one is. A
 * side that is not a side is kept as it is, so `validateGraph` reports it. Numbers are not canonicalised: a `NaN`
 * payload may not survive the trip, so the fixtures hold finite values.
 */

import {
  FrameError,
  KIND_GRAPH,
  KIND_LAYOUT,
  Reader,
  Writer,
} from "./frameCodec.js";
import type {
  EdgeLayout,
  LayoutCluster,
  LayoutEdge,
  LayoutGraph,
  LayoutMetrics,
  LayoutNode,
  LayoutPort,
  LayoutResult,
  NodeLayout,
  Rect,
  Side,
} from "./types.js";

export { FrameError };

type Hint = { rank: number; order: number; x: number; y: number };

/** The key with its value, or nothing when the value is absent: an optional field is left out, not set to undefined. */
function field<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

/** The element of a column at `row`. Every column of a table has the row count that `Reader` checked. */
function at<T>(values: readonly T[], row: number): T {
  return values[row] as T;
}

/** The frame of a graph (`LayoutGraph`). */
export function encodeGraph(graph: LayoutGraph): Uint8Array {
  const writer = new Writer();
  putNodes(writer, graph.nodes);
  putEdges(writer, graph.edges);
  putClusters(writer, graph.clusters ?? []);
  return writer.finish(KIND_GRAPH);
}

function putNodes(writer: Writer, nodes: readonly LayoutNode[]): void {
  writer.texts(nodes.map((node) => node.id));
  writer.f64s(nodes.map((node) => node.width));
  writer.f64s(nodes.map((node) => node.height));
  writer.optTexts(nodes.map((node) => node.cluster));
  writer.optF64s(nodes.map((node) => node.partition));
  const ports = nodes.flatMap((node, owner) =>
    (node.ports ?? []).map((port) => ({ owner, port })),
  );
  writer.u32s(ports.map((entry) => entry.owner));
  writer.texts(ports.map((entry) => entry.port.id));
  writer.texts(ports.map((entry) => entry.port.side));
  writer.f64s(ports.map((entry) => entry.port.offset));
}

function putEdges(writer: Writer, edges: readonly LayoutEdge[]): void {
  writer.texts(edges.map((edge) => edge.id));
  writer.texts(edges.map((edge) => edge.source));
  writer.texts(edges.map((edge) => edge.target));
  writer.optTexts(edges.map((edge) => edge.sourcePort));
  writer.optTexts(edges.map((edge) => edge.targetPort));
  writer.texts(edges.map((edge) => edge.kind));
}

function putClusters(writer: Writer, clusters: readonly LayoutCluster[]): void {
  writer.texts(clusters.map((cluster) => cluster.id));
  writer.optTexts(clusters.map((cluster) => cluster.parent));
  writer.optF64s(clusters.map((cluster) => cluster.padding));
  writer.optF64s(clusters.map((cluster) => cluster.labelHeight));
  writer.optBools(clusters.map((cluster) => cluster.opaque));
}

/** The graph a frame of a graph holds. It throws `FrameError` on any frame that is not one. */
export function decodeGraph(bytes: Uint8Array): LayoutGraph {
  const reader = new Reader(bytes, KIND_GRAPH);
  const nodes = readNodes(reader);
  const edges = readEdges(reader);
  const clusters = readClusters(reader);
  reader.end();
  return { nodes, edges, ...(clusters.length > 0 ? { clusters } : {}) };
}

function readNodes(reader: Reader): LayoutNode[] {
  const ids = reader.texts("nodes.id");
  const count = ids.length;
  const widths = reader.f64s("nodes.width", count);
  const heights = reader.f64s("nodes.height", count);
  const clusterOf = reader.optTexts("nodes.cluster", count);
  const partitions = reader.optF64s("nodes.partition", count);
  const owners = reader.u32s("ports.node");
  const portCount = owners.length;
  const portIds = reader.texts("ports.id", portCount);
  const sides = reader.texts("ports.side", portCount);
  const offsets = reader.f64s("ports.offset", portCount);
  const portsOf: LayoutPort[][] = ids.map(() => []);
  owners.forEach((owner, row) => {
    const ports = portsOf[owner];
    if (ports === undefined) {
      throw new FrameError(`ports.node ${owner} names no node`);
    }
    ports.push({
      id: at(portIds, row),
      side: at(sides, row) as Side,
      offset: at(offsets, row),
    });
  });
  return ids.map((id, row) => {
    const ports = at(portsOf, row);
    return {
      id,
      width: at(widths, row),
      height: at(heights, row),
      ...(ports.length > 0 ? { ports } : {}),
      ...field("cluster", at(clusterOf, row)),
      ...field("partition", at(partitions, row)),
    };
  });
}

function readEdges(reader: Reader): LayoutEdge[] {
  const ids = reader.texts("edges.id");
  const count = ids.length;
  const sources = reader.texts("edges.source", count);
  const targets = reader.texts("edges.target", count);
  const sourcePorts = reader.optTexts("edges.sourcePort", count);
  const targetPorts = reader.optTexts("edges.targetPort", count);
  const kinds = reader.texts("edges.kind", count);
  return ids.map((id, row) => ({
    id,
    source: at(sources, row),
    target: at(targets, row),
    kind: at(kinds, row),
    ...field("sourcePort", at(sourcePorts, row)),
    ...field("targetPort", at(targetPorts, row)),
  }));
}

function readClusters(reader: Reader): LayoutCluster[] {
  const ids = reader.texts("clusters.id");
  const count = ids.length;
  const parents = reader.optTexts("clusters.parent", count);
  const paddings = reader.optF64s("clusters.padding", count);
  const labelHeights = reader.optF64s("clusters.labelHeight", count);
  const opaques = reader.optBools("clusters.opaque", count);
  return ids.map((id, row) => ({
    id,
    ...field("parent", at(parents, row)),
    ...field("padding", at(paddings, row)),
    ...field("labelHeight", at(labelHeights, row)),
    ...field("opaque", at(opaques, row)),
  }));
}

/**
 * The frame of a layout (`LayoutResult`). Rows follow the iteration order of its maps, and the edge points are one run
 * per edge, so `edges.pointStart` is the running count of points.
 */
export function encodeLayout(result: LayoutResult): Uint8Array {
  const writer = new Writer();
  putNodeLayouts(writer, [...result.nodes]);
  putEdgeLayouts(writer, [...result.edges]);
  putClusterRects(writer, [...result.clusters]);
  putPartitions(writer, result.partitions);
  const { bounds, metrics } = result;
  writer.f64s([bounds.x, bounds.y, bounds.width, bounds.height]);
  putHints(writer, [...result.hints.nodes]);
  writer.f64s([
    metrics.crossings,
    metrics.bends,
    metrics.edgeLength,
    metrics.area,
    metrics.density,
    metrics.overlaps,
    metrics.opaqueBreaches,
  ]);
  return writer.finish(KIND_LAYOUT);
}

function putNodeLayouts(
  writer: Writer,
  nodes: ReadonlyArray<[string, NodeLayout]>,
): void {
  writer.texts(nodes.map(([id]) => id));
  writer.f64s(nodes.map(([, node]) => node.x));
  writer.f64s(nodes.map(([, node]) => node.y));
  writer.f64s(nodes.map(([, node]) => node.width));
  writer.f64s(nodes.map(([, node]) => node.height));
  writer.u32s(nodes.map(([, node]) => node.rank));
  writer.u32s(nodes.map(([, node]) => node.order));
}

function putEdgeLayouts(
  writer: Writer,
  edges: ReadonlyArray<[string, EdgeLayout]>,
): void {
  writer.texts(edges.map(([id]) => id));
  const pointStart = [0];
  for (const [, edge] of edges) {
    pointStart.push((pointStart.at(-1) ?? 0) + edge.points.length);
  }
  writer.u32s(pointStart);
  const points = edges.flatMap(([, edge]) => edge.points);
  writer.f64s(points.map((point) => point.x));
  writer.f64s(points.map((point) => point.y));
  writer.bools(edges.map(([, edge]) => edge.reversed));
  writer.bools(edges.map(([, edge]) => edge.routeFailed));
}

function putClusterRects(
  writer: Writer,
  clusters: ReadonlyArray<[string, Rect]>,
): void {
  writer.texts(clusters.map(([id]) => id));
  writer.f64s(clusters.map(([, rect]) => rect.x));
  writer.f64s(clusters.map(([, rect]) => rect.y));
  writer.f64s(clusters.map(([, rect]) => rect.width));
  writer.f64s(clusters.map(([, rect]) => rect.height));
}

function putPartitions(
  writer: Writer,
  partitions: LayoutResult["partitions"],
): void {
  writer.f64s(partitions.map((box) => box.partition));
  writer.f64s(partitions.map((box) => box.x));
  writer.f64s(partitions.map((box) => box.y));
  writer.f64s(partitions.map((box) => box.width));
  writer.f64s(partitions.map((box) => box.height));
}

function putHints(writer: Writer, hints: ReadonlyArray<[string, Hint]>): void {
  writer.texts(hints.map(([id]) => id));
  writer.u32s(hints.map(([, hint]) => hint.rank));
  writer.u32s(hints.map(([, hint]) => hint.order));
  writer.f64s(hints.map(([, hint]) => hint.x));
  writer.f64s(hints.map(([, hint]) => hint.y));
}

/** The layout a frame of a layout holds. It throws `FrameError` on any frame that is not one, or whose points do not add up. */
export function decodeLayout(bytes: Uint8Array): LayoutResult {
  const reader = new Reader(bytes, KIND_LAYOUT);
  const nodes = readNodeLayouts(reader);
  const edges = readEdgeLayouts(reader);
  const clusters = readClusterRects(reader);
  const partitions = readPartitions(reader);
  const [boundsX, boundsY, boundsWidth, boundsHeight] = reader.f64s(
    "bounds",
    4,
  );
  const hints = readHints(reader);
  const metrics = readMetrics(reader);
  reader.end();
  return {
    nodes,
    edges,
    clusters,
    partitions,
    bounds: {
      x: boundsX ?? 0,
      y: boundsY ?? 0,
      width: boundsWidth ?? 0,
      height: boundsHeight ?? 0,
    },
    hints: { nodes: hints },
    metrics,
  };
}

function readNodeLayouts(reader: Reader): Map<string, NodeLayout> {
  const ids = reader.texts("nodes.id");
  const count = ids.length;
  const x = reader.f64s("nodes.x", count);
  const y = reader.f64s("nodes.y", count);
  const width = reader.f64s("nodes.width", count);
  const height = reader.f64s("nodes.height", count);
  const rank = reader.u32s("nodes.rank", count);
  const order = reader.u32s("nodes.order", count);
  return new Map(
    ids.map((id, row): [string, NodeLayout] => [
      id,
      {
        x: at(x, row),
        y: at(y, row),
        width: at(width, row),
        height: at(height, row),
        rank: at(rank, row),
        order: at(order, row),
      },
    ]),
  );
}

function readEdgeLayouts(reader: Reader): Map<string, EdgeLayout> {
  const ids = reader.texts("edges.id");
  const count = ids.length;
  const pointStart = reader.u32s("edges.pointStart", count + 1);
  const pointX = reader.f64s("edges.pointX");
  const pointCount = pointX.length;
  const pointY = reader.f64s("edges.pointY", pointCount);
  const reversed = reader.bools("edges.reversed", count);
  const routeFailed = reader.bools("edges.routeFailed", count);
  const runsOverPoints =
    pointStart[0] === 0 &&
    pointStart[count] === pointCount &&
    pointStart.every(
      (start, row) => row === 0 || start >= at(pointStart, row - 1),
    );
  if (!runsOverPoints) {
    throw new FrameError(
      "edges.pointStart does not run from 0 to the point count",
    );
  }
  return new Map(
    ids.map((id, row): [string, EdgeLayout] => {
      const from = at(pointStart, row);
      const to = at(pointStart, row + 1);
      const points = Array.from({ length: to - from }, (_, k) => ({
        x: at(pointX, from + k),
        y: at(pointY, from + k),
      }));
      return [
        id,
        {
          points,
          reversed: at(reversed, row),
          routeFailed: at(routeFailed, row),
        },
      ];
    }),
  );
}

function readClusterRects(reader: Reader): Map<string, Rect> {
  const ids = reader.texts("clusters.id");
  const count = ids.length;
  const x = reader.f64s("clusters.x", count);
  const y = reader.f64s("clusters.y", count);
  const width = reader.f64s("clusters.width", count);
  const height = reader.f64s("clusters.height", count);
  return new Map(
    ids.map((id, row): [string, Rect] => [
      id,
      {
        x: at(x, row),
        y: at(y, row),
        width: at(width, row),
        height: at(height, row),
      },
    ]),
  );
}

function readPartitions(reader: Reader): LayoutResult["partitions"] {
  const partitions = reader.f64s("partitions.partition");
  const count = partitions.length;
  const x = reader.f64s("partitions.x", count);
  const y = reader.f64s("partitions.y", count);
  const width = reader.f64s("partitions.width", count);
  const height = reader.f64s("partitions.height", count);
  return partitions.map((partition, row) => ({
    partition,
    x: at(x, row),
    y: at(y, row),
    width: at(width, row),
    height: at(height, row),
  }));
}

function readHints(reader: Reader): Map<string, Hint> {
  const ids = reader.texts("hints.id");
  const count = ids.length;
  const rank = reader.u32s("hints.rank", count);
  const order = reader.u32s("hints.order", count);
  const x = reader.f64s("hints.x", count);
  const y = reader.f64s("hints.y", count);
  return new Map(
    ids.map((id, row): [string, Hint] => [
      id,
      {
        rank: at(rank, row),
        order: at(order, row),
        x: at(x, row),
        y: at(y, row),
      },
    ]),
  );
}

function readMetrics(reader: Reader): LayoutMetrics {
  const [
    crossings,
    bends,
    edgeLength,
    area,
    density,
    overlaps,
    opaqueBreaches,
  ] = reader.f64s("metrics", 7);
  return {
    crossings: crossings ?? 0,
    bends: bends ?? 0,
    edgeLength: edgeLength ?? 0,
    area: area ?? 0,
    density: density ?? 0,
    overlaps: overlaps ?? 0,
    opaqueBreaches: opaqueBreaches ?? 0,
  };
}
