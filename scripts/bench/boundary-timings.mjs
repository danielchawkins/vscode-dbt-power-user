#!/usr/bin/env node
// Boundary cost of the bindings (S1, the plan's Phase 8; ADR 0011 Decision 6). For WASM and for napi, on one flattened
// graph (`flatten-graph.mjs` output), it times in milliseconds, as nearest-rank p50 and p95 over the samples:
//   encode   the graph frame built in JS from the flattened records (the wrapper JSON-encodes the options per call)
//   copy in  a call on the engine handle with a stale generation: the frame is copied into the binding and decoded
//            there, and the call returns before any layout runs
//   copy out the result bytes copied again in JS, an upper bound for the binding's own copy, which is not isolated
//   decode   the JS decode of a layout frame into columns and strings
//   layout   the one-shot call on the graph, the full call with layout, for context
// The round trip is encode + copy in + copy out + decode, timed per sample, so its p95 is a percentile of the whole path. For the columnar-vs-JSON criterion it also
// times encode plus decode of the graph frame, and of the same graph as JSON. The layout core reads no clock: this
// timing is here, outside it. Contributor tooling only; it ships nothing.
//
//   node scripts/bench/boundary-timings.mjs <dist dir> <flattened graph> [samples=30]

import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  Engine,
  layout,
  loadNative,
  loadWasm,
} from "../../crates/graph-layout-wasm/js/index.mjs";

const [dirArg, graphArg, samplesArg = "30"] = process.argv.slice(2);
if (dirArg === undefined || graphArg === undefined) {
  console.error(
    "usage: node scripts/bench/boundary-timings.mjs <dist dir> <flattened graph> [samples=30]",
  );
  process.exit(2);
}
const samples = Number(samplesArg);

// The options of the S12 baseline (`baseline_options` in crates/graph-layout/src/engine/layout/bench.rs) at `balanced`.
const OPTIONS = {
  direction: "down",
  edgeKinds: { table: { ranks: true } },
  spacing: { node: 28, rank: 36, edge: 6, cluster: 28 },
  partitions: "soft",
  ranks: "rows",
  effort: "balanced",
};

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** The flattened records: `node`, `cluster` and `edge` lines, tab-separated; `-` is no value; `#` lines are comments. */
function parseFlattened(text) {
  const graph = { nodes: [], edges: [], clusters: [] };
  const optional = (field) => (field === "-" ? undefined : field);
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const f = line.split("\t");
    if (f[0] === "node") {
      graph.nodes.push({
        id: f[1],
        width: Number(f[2]),
        height: Number(f[3]),
        partition: optional(f[4]) === undefined ? undefined : Number(f[4]),
        cluster: optional(f[5]),
      });
    } else if (f[0] === "cluster") {
      graph.clusters.push({ id: f[1], padding: Number(f[2]) });
    } else if (f[0] === "edge") {
      graph.edges.push({ id: f[1], source: f[2], target: f[3], kind: f[4] });
    } else {
      throw new Error(`not a flattened record: ${line}`);
    }
  }
  return graph;
}

/** Builds one frame (ADR 0011 Decision 6, `model/frame.rs`): a header, the text blob, then the columns in order. */
class Writer {
  #columns = [];
  #blob = [];
  #blobLength = 0;

  #column(tag, rows, payload) {
    const head = Buffer.alloc(5);
    head[0] = tag;
    head.writeUInt32LE(rows, 1);
    this.#columns.push(head, payload);
  }

  u8(values) {
    this.#column(1, values.length, Buffer.from(values));
  }

  bools(values) {
    this.u8(values.map(Number));
  }

  u32(values) {
    const payload = Buffer.alloc(4 * values.length);
    values.forEach((value, i) => payload.writeUInt32LE(value, 4 * i));
    this.#column(2, values.length, payload);
  }

  f64(values) {
    const payload = Buffer.alloc(8 * values.length);
    values.forEach((value, i) => payload.writeDoubleLE(value, 8 * i));
    this.#column(3, values.length, payload);
  }

  texts(values) {
    const offsets = Buffer.alloc(4 * (values.length + 1));
    values.forEach((value, i) => {
      offsets.writeUInt32LE(this.#blobLength, 4 * i);
      const bytes = TEXT_ENCODER.encode(value);
      this.#blob.push(bytes);
      this.#blobLength += bytes.length;
    });
    offsets.writeUInt32LE(this.#blobLength, 4 * values.length);
    this.#column(4, values.length, offsets);
  }

  optTexts(values) {
    this.bools(values.map((value) => value !== undefined));
    this.texts(values.map((value) => value ?? ""));
  }

  optF64(values) {
    this.bools(values.map((value) => value !== undefined));
    this.f64(values.map((value) => value ?? 0));
  }

  optBools(values) {
    this.u8(values.map((value) => (value === undefined ? 0 : value ? 2 : 1)));
  }

  finish(kind) {
    const head = Buffer.alloc(16);
    head.write("GLFR", 0, "latin1");
    head.writeUInt32LE(1, 4);
    head.writeUInt32LE(kind, 8);
    head.writeUInt32LE(this.#blobLength, 12);
    return Buffer.concat([head, ...this.#blob, ...this.#columns]);
  }
}

/** The graph frame, columns in the order `put_nodes`, `put_edges`, `put_clusters` write them. */
function encodeGraph(graph) {
  const writer = new Writer();
  const { nodes, edges, clusters } = graph;
  writer.texts(nodes.map((node) => node.id));
  writer.f64(nodes.map((node) => node.width));
  writer.f64(nodes.map((node) => node.height));
  writer.optTexts(nodes.map((node) => node.cluster));
  writer.optF64(nodes.map((node) => node.partition));
  writer.u32([]);
  writer.texts([]);
  writer.texts([]);
  writer.f64([]);
  writer.texts(edges.map((edge) => edge.id));
  writer.texts(edges.map((edge) => edge.source));
  writer.texts(edges.map((edge) => edge.target));
  writer.optTexts(edges.map(() => undefined));
  writer.optTexts(edges.map(() => undefined));
  writer.texts(edges.map((edge) => edge.kind));
  writer.texts(clusters.map((cluster) => cluster.id));
  writer.optTexts(clusters.map(() => undefined));
  writer.optF64(clusters.map((cluster) => cluster.padding));
  writer.optF64(clusters.map(() => undefined));
  writer.optBools(clusters.map(() => undefined));
  return writer.finish(1);
}

/** Decodes any frame into its columns: the tag, the row count and the values, numbers or strings (a JS-side read). */
function decodeFrame(bytes) {
  if (bytes.subarray(0, 4).toString("latin1") !== "GLFR") {
    throw new Error("not a frame");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blobLength = view.getUint32(12, true);
  const blob = bytes.subarray(16, 16 + blobLength);
  let at = 16 + blobLength;
  const columns = [];
  while (at < bytes.length) {
    const tag = view.getUint8(at);
    const rows = view.getUint32(at + 1, true);
    at += 5;
    let values;
    if (tag === 1) {
      values = bytes.subarray(at, at + rows);
      at += rows;
    } else if (tag === 2) {
      values = Array.from({ length: rows });
      for (let i = 0; i < rows; i++) {
        values[i] = view.getUint32(at, true);
        at += 4;
      }
    } else if (tag === 3) {
      values = Array.from({ length: rows });
      for (let i = 0; i < rows; i++) {
        values[i] = view.getFloat64(at, true);
        at += 8;
      }
    } else if (tag === 4) {
      const offsets = Array.from({ length: rows + 1 });
      for (let i = 0; i <= rows; i++) {
        offsets[i] = view.getUint32(at, true);
        at += 4;
      }
      values = Array.from({ length: rows });
      for (let i = 0; i < rows; i++) {
        values[i] = TEXT_DECODER.decode(
          blob.subarray(offsets[i], offsets[i + 1]),
        );
      }
    } else {
      throw new Error(`unknown column tag ${tag}`);
    }
    columns.push({ tag, rows, values });
  }
  return columns;
}

/** The nearest-rank percentile of sorted values, as S12 takes it. */
const percentile = (sorted, p) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

/** One untimed warm-up call, then `count` timed calls: p50 and p95 in milliseconds. */
function time(fn, count) {
  fn();
  const ms = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    fn();
    ms.push(performance.now() - start);
  }
  ms.sort((a, b) => a - b);
  const round = (value) => Number(value.toFixed(3));
  return { p50: round(percentile(ms, 0.5)), p95: round(percentile(ms, 0.95)) };
}

const dir = path.resolve(dirArg);
const graphPath = path.resolve(graphArg);
const graph = parseFlattened(readFileSync(graphPath, "utf8"));
const frame = encodeGraph(graph);
const json = JSON.stringify(graph);
const layoutFrame = layout(loadNative(dir), frame, OPTIONS);

const columnar = {
  encode: time(() => encodeGraph(graph), samples),
  decode: time(() => decodeFrame(frame), samples),
};
columnar.roundTrip = {
  p50: Number((columnar.encode.p50 + columnar.decode.p50).toFixed(3)),
};
const jsonRound = time(() => JSON.parse(JSON.stringify(graph)), samples);
const layoutDecode = time(() => decodeFrame(layoutFrame), samples);

/** The round trip of one binding: its copy in (stale-generation handle call), copy out and the JS decode, per sample. */
function measure(binding, bigint) {
  const engine = new Engine(binding, { bigint });
  // Records generation 2 as started (one full layout, untimed), so generation 1 is stale and returns before layout.
  engine.layout(frame, OPTIONS, 2);
  const staleCall = (bytes) => {
    const result = engine.layout(bytes, OPTIONS, 1);
    if (result !== undefined) {
      throw new Error("a stale generation returned a layout");
    }
  };
  const copyIn = time(() => staleCall(frame), samples);
  const copyOut = time(() => new Uint8Array(layoutFrame), samples);
  // Each sample is the whole path: encode the graph, copy it in, copy the result out and decode it.
  const roundTrip = time(() => {
    staleCall(encodeGraph(graph));
    new Uint8Array(layoutFrame);
    decodeFrame(layoutFrame);
  }, samples);
  const layoutCall = time(() => layout(binding, frame, OPTIONS), samples);
  return { copyIn, copyOut, layoutCall, roundTrip };
}

const report = {
  graph: path.basename(graphPath),
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  clusters: graph.clusters.length,
  samples,
  bytes: {
    graphFrame: frame.length,
    layoutFrame: layoutFrame.length,
    json: Buffer.byteLength(json),
  },
  columnar,
  json: { roundTrip: jsonRound },
  layoutDecode,
  napi: measure(loadNative(dir), false),
  wasm: measure(loadWasm(dir), true),
};
report.jsonToColumnar = Number(
  (jsonRound.p50 / (columnar.encode.p50 + columnar.decode.p50)).toFixed(2),
);
console.log(JSON.stringify(report, null, 2));
