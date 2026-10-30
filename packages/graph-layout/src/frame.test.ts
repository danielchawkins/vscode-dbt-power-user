import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeGraph,
  decodeLayout,
  encodeGraph,
  encodeLayout,
  FrameError,
} from "./frame.js";
import {
  emptyLayout,
  goldenGraph,
  goldenLayout,
} from "./testing/frameGolden.js";
import type { LayoutGraph } from "./types.js";

// The committed fixture the Rust core also decodes (`crates/graph-layout/src/testkit`). `print-fixtures.mjs frame`
// prints it; a change to the encoder that moves a byte fails here before the cross-language check does.
const FIXTURE = path.join(
  import.meta.dirname,
  "../../../crates/graph-layout/fixtures/parity/frame.txt",
);

/** The lowercase hex of the frame the fixture holds for `kind` (`graph`, `layout` or `empty-layout`). */
function fixtureFrame(kind: string): string {
  const prefix = `frame ${kind} `;
  const line = readFileSync(FIXTURE, "utf8")
    .split("\n")
    .find((row) => row.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`the fixture holds no frame ${kind}`);
  }
  return line.slice(prefix.length);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

describe("columnar frame", () => {
  it("round-trips the golden graph", () => {
    expect(decodeGraph(encodeGraph(goldenGraph))).toEqual(goldenGraph);
  });

  it("round-trips the golden layout", () => {
    expect(decodeLayout(encodeLayout(goldenLayout))).toEqual(goldenLayout);
  });

  it("round-trips an empty graph and an empty layout", () => {
    const graph: LayoutGraph = { nodes: [], edges: [] };
    expect(decodeGraph(encodeGraph(graph))).toEqual(graph);
    const empty = decodeLayout(
      encodeLayout({
        ...goldenLayout,
        nodes: new Map(),
        edges: new Map(),
        clusters: new Map(),
        partitions: [],
        hints: { nodes: new Map() },
      }),
    );
    expect(empty.nodes.size).toBe(0);
    expect(empty.edges.size).toBe(0);
  });

  it("opens with the magic, the version and the kind", () => {
    const bytes = encodeGraph(goldenGraph);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("GLFR");
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(1);
    expect(new DataView(bytes.buffer).getUint32(8, true)).toBe(1);
    expect(
      new DataView(encodeLayout(goldenLayout).buffer).getUint32(8, true),
    ).toBe(2);
  });

  it("refuses a frame of the wrong kind", () => {
    expect(() => decodeLayout(encodeGraph(goldenGraph))).toThrow(FrameError);
    expect(() => decodeGraph(encodeLayout(goldenLayout))).toThrow(
      /kind 2 is not 1/,
    );
  });

  it("refuses bad magic, a bad version, a truncated frame and trailing bytes", () => {
    const bytes = encodeGraph(goldenGraph);
    const badMagic = bytes.slice();
    badMagic[0] = 0x58;
    expect(() => decodeGraph(badMagic)).toThrow(/magic/);
    const badVersion = bytes.slice();
    badVersion[4] = 2;
    expect(() => decodeGraph(badVersion)).toThrow(/version 2/);
    expect(() => decodeGraph(bytes.subarray(0, bytes.length - 3))).toThrow(
      /end inside|offset/,
    );
    const trailing = new Uint8Array([...bytes, 0]);
    expect(() => decodeGraph(trailing)).toThrow(/after the last column/);
  });

  it("refuses a text blob that is not UTF-8", () => {
    const bytes = encodeGraph(goldenGraph);
    // "ñ" is C3 B1 in UTF-8; C3 28 is not a UTF-8 sequence.
    const at = bytes.findIndex(
      (byte, i) => byte === 0xc3 && bytes[i + 1] === 0xb1,
    );
    expect(at).toBeGreaterThan(0);
    bytes[at + 1] = 0x28;
    expect(() => decodeGraph(bytes)).toThrow(/not UTF-8/);
  });

  it("refuses to encode a lone surrogate", () => {
    const graph: LayoutGraph = {
      nodes: [{ id: "\ud800", width: 1, height: 1 }],
      edges: [],
    };
    expect(() => encodeGraph(graph)).toThrow(/lone surrogate/);
  });

  it("refuses a port whose node is not in the frame", () => {
    const bytes = encodeGraph(goldenGraph);
    const corrupted = bytes.slice();
    const view = new DataView(corrupted.buffer);
    // The first u32 column is `ports.node`: its tag (2) and its row count (3, the golden's three ports), then the owners.
    const marker = [2, 3, 0, 0, 0];
    let at = -1;
    for (let i = 0; i + marker.length <= corrupted.length && at < 0; i++) {
      if (marker.every((byte, k) => corrupted[i + k] === byte)) {
        at = i + marker.length;
      }
    }
    expect(at).toBeGreaterThan(0);
    view.setUint32(at, 99, true);
    expect(() => decodeGraph(corrupted)).toThrow(/names no node/);
  });

  it("encodes the golden inputs to the bytes of the committed fixture", () => {
    expect(hex(encodeGraph(goldenGraph))).toBe(fixtureFrame("graph"));
    expect(hex(encodeLayout(goldenLayout))).toBe(fixtureFrame("layout"));
    expect(hex(encodeLayout(emptyLayout))).toBe(fixtureFrame("empty-layout"));
  });
});
