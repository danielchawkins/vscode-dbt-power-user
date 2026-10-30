/**
 * The golden inputs of the columnar frame. `scripts/parity/print-fixtures.mjs frame` encodes them into the committed
 * `crates/graph-layout/fixtures/parity/frame.txt`, which the Rust core decodes and re-encodes to the same bytes. They
 * use every optional field both present and absent, an edge with no points, and a non-ASCII id.
 */

import type { LayoutGraph, LayoutResult } from "../types.js";

export const goldenGraph: LayoutGraph = {
  nodes: [
    {
      id: "orders",
      width: 120,
      height: 48.5,
      ports: [
        { id: "out", side: "east", offset: 24 },
        { id: "in", side: "west", offset: 0.25 },
      ],
      cluster: "warehouse",
      partition: 0,
    },
    { id: "ñ-stock", width: 96, height: 40 },
    {
      id: "customers",
      width: 110,
      height: 40,
      ports: [{ id: "in", side: "west", offset: 20 }],
      partition: 2,
    },
  ],
  edges: [
    {
      id: "orders->stock",
      source: "orders",
      target: "ñ-stock",
      sourcePort: "out",
      kind: "lineage",
    },
    {
      id: "stock->customers",
      source: "ñ-stock",
      target: "customers",
      targetPort: "in",
      kind: "ref",
    },
    {
      id: "customers->orders",
      source: "customers",
      target: "orders",
      kind: "ref",
    },
  ],
  clusters: [
    { id: "warehouse", padding: 12, labelHeight: 20, opaque: true },
    { id: "outer", parent: "warehouse" },
  ],
};

export const goldenLayout: LayoutResult = {
  nodes: new Map([
    ["orders", { x: 0, y: 0, width: 120, height: 48.5, rank: 0, order: 0 }],
    ["ñ-stock", { x: 180, y: 0, width: 96, height: 40, rank: 1, order: 0 }],
    [
      "customers",
      { x: 180, y: 120, width: 110, height: 40, rank: 2, order: 0 },
    ],
  ]),
  edges: new Map([
    [
      "orders->stock",
      {
        points: [
          { x: 120, y: 24 },
          { x: 150, y: 24 },
          { x: 150, y: 20 },
          { x: 180, y: 20 },
        ],
        reversed: false,
        routeFailed: false,
      },
    ],
    ["stock->customers", { points: [], reversed: false, routeFailed: true }],
    [
      "customers->orders",
      {
        points: [
          { x: 180, y: 140 },
          { x: 60, y: 140 },
        ],
        reversed: true,
        routeFailed: false,
      },
    ],
  ]),
  clusters: new Map([
    ["warehouse", { x: -12, y: -32, width: 336, height: 216 }],
  ]),
  partitions: [
    { partition: 0, x: 0, y: 0, width: 300, height: 48.5 },
    { partition: 2, x: 0, y: 120, width: 300, height: 40 },
  ],
  bounds: { x: -12, y: -32, width: 336, height: 216 },
  hints: {
    nodes: new Map([
      ["orders", { rank: 0, order: 0, x: 0, y: 0 }],
      ["customers", { rank: 2, order: 0, x: 180, y: 120 }],
    ]),
  },
  metrics: {
    crossings: 0,
    bends: 3,
    edgeLength: 182.5,
    area: 40320,
    density: 0.25,
    overlaps: 0,
    opaqueBreaches: 1,
  },
};

/**
 * The layout the hello stub returns for any graph: nothing placed, all zeros. `frame empty-layout` pins its encoding,
 * which the Rust core (`engine::layout_frame`) must reproduce byte for byte.
 */
export const emptyLayout: LayoutResult = {
  nodes: new Map(),
  edges: new Map(),
  clusters: new Map(),
  partitions: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  hints: { nodes: new Map() },
  metrics: {
    crossings: 0,
    bends: 0,
    edgeLength: 0,
    area: 0,
    density: 0,
    overlaps: 0,
    opaqueBreaches: 0,
  },
};
