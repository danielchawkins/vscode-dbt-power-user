import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { LayoutGraph } from "./types.js";
import { validateGraph } from "./validate.js";

const kinds = {
  edgeKinds: {
    dependency: { ranks: true },
    relationship: { ranks: false, weight: 0.3 },
  },
};

const node = (id: string, extra: object = {}) => ({
  id,
  width: 200,
  height: 60,
  ...extra,
});

describe("validateGraph", () => {
  it("accepts a graph with ports, clusters and both edge kinds", () => {
    const graph: LayoutGraph = {
      nodes: [
        node("a", { ports: [{ id: "c1", side: "east", offset: 30 }] }),
        node("b", { cluster: "g" }),
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          sourcePort: "c1",
          kind: "dependency",
        },
        { id: "e2", source: "b", target: "a", kind: "relationship" },
      ],
      clusters: [{ id: "g" }],
    };
    expect(validateGraph(graph, kinds)).toEqual([]);
  });

  it("reports every issue at once", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("a"), node("z", { width: 0, cluster: "nope" })],
      edges: [
        { id: "e", source: "a", target: "missing", kind: "dependency" },
        { id: "e", source: "a", target: "z", sourcePort: "p", kind: "other" },
      ],
      clusters: [
        { id: "x", parent: "y" },
        { id: "y", parent: "x" },
      ],
    };
    expect(
      validateGraph(graph, kinds)
        .map((i) => `${i.code}:${i.subject}`)
        .sort(),
    ).toEqual(
      [
        "bad-size:z",
        "cluster-cycle:x",
        "cluster-cycle:y",
        "duplicate-id:a",
        "duplicate-id:e",
        "unknown-cluster:z",
        "unknown-kind:e",
        "unknown-node:e",
        "unknown-port:e",
      ].sort(),
    );
  });

  it("accepts any graph whose edges join known nodes by a known kind", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 60 }),
        (count, pairs) => {
          const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
          const edges = pairs.map(([s, t, ranks], i) => ({
            id: `e${i}`,
            source: `n${s % count}`,
            target: `n${t % count}`,
            kind: ranks ? "dependency" : "relationship",
          }));
          expect(validateGraph({ nodes, edges }, kinds)).toEqual([]);
        },
      ),
    );
  });
});
