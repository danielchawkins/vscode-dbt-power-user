import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type LayeredGraph, layer } from "./layering.js";
import { type RankResult, rank } from "./rank/index.js";
import type {
  EdgeKindPolicy,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
} from "./types.js";

const KINDS: Readonly<Record<string, EdgeKindPolicy>> = {
  dependency: { ranks: true, weight: 1 },
  heavy: { ranks: true, weight: 4 },
  column: { ranks: false, weight: 0.5 },
};
const KIND_NAMES = Object.keys(KINDS);

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: KINDS,
  spacing: { edge: 4 },
};

const node = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id,
  width: 100,
  height: 40,
  ...extra,
});

const edge = (id: string, source: string, target: string): LayoutEdge => ({
  id,
  source,
  target,
  kind: "dependency",
});

const ranking = (
  ranks: Record<string, number>,
  reversed: string[] = [],
): RankResult => ({ ranks: new Map(Object.entries(ranks)), reversed });

describe("layer", () => {
  it("spans a long edge with one dummy per intermediate rank", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("e", "a", "c")],
    };
    const out = layer(graph, options, ranking({ a: 0, b: 1, c: 3 }));
    expect(out.ranks).toBe(4);
    expect(out.nodes.slice(0, 3).map((n) => n.id)).toEqual(["a", "b", "c"]);
    const bundle = out.bundles[0];
    expect(bundle.chain).toHaveLength(4);
    expect(bundle.chain.slice(1, 3).map((i) => out.nodes[i].rank)).toEqual([
      1, 2,
    ]);
    expect(out.nodes[bundle.chain[1]]).toEqual({
      id: undefined,
      rank: 1,
      breadth: 4,
    });
    expect(out.segments).toHaveLength(3);
    expect(out.segments.map((s) => s.weight)).toEqual([1, 1, 1]);
  });

  it("bundles parallel edges of one kind into one chain sized by member count", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("b")],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "b"), edge("e3", "a", "b")],
    };
    const out = layer(graph, options, ranking({ a: 0, b: 1 }));
    expect(out.bundles).toHaveLength(1);
    expect(out.bundles[0].edges).toEqual(["e1", "e2", "e3"]);
    expect(out.bundles[0].weight).toBeCloseTo(Math.sqrt(3));
    expect(out.segments).toHaveLength(1);
  });

  it("keeps one bundle per kind between the same pair", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("b")],
      edges: [edge("d", "a", "b"), { ...edge("c", "a", "b"), kind: "column" }],
    };
    const out = layer(graph, options, ranking({ a: 0, b: 0 }));
    expect(out.bundles.map((b) => b.kind)).toEqual(["dependency", "column"]);
  });

  it("keeps bundles apart when node ids contain the separator", () => {
    const graph: LayoutGraph = {
      nodes: [node("a|b"), node("c"), node("a"), node("b|c")],
      edges: [edge("e1", "a|b", "c"), edge("e2", "a", "b|c")],
    };
    const out = layer(
      graph,
      options,
      ranking({ "a|b": 0, c: 1, a: 0, "b|c": 1 }),
    );
    expect(out.bundles.map((b) => b.edges)).toEqual([["e1"], ["e2"]]);
  });

  it("keeps a same-rank bundle flat, with no dummies or segments", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("b")],
      edges: [{ ...edge("c", "a", "b"), kind: "column" }],
    };
    const out = layer(graph, options, ranking({ a: 2, b: 2 }));
    expect(out.bundles[0]).toMatchObject({ flat: true, chain: [0, 1] });
    expect(out.segments).toEqual([]);
    expect(out.nodes).toHaveLength(2);
  });

  it("marks a bundle whose ranks run against it as reversed, with its target above", () => {
    const graph: LayoutGraph = {
      nodes: [node("a"), node("b")],
      edges: [edge("e", "a", "b")],
    };
    const out = layer(graph, options, ranking({ a: 1, b: 0 }, ["e"]));
    const bundle = out.bundles[0];
    expect(bundle.reversed).toBe(true);
    expect(bundle.chain).toEqual([1, 0]);
    expect(out.segments[0]).toMatchObject({ top: 1, bottom: 0 });
  });

  it("counts a port offset only on the side that faces the adjacent rank", () => {
    const ports = [
      { id: "south", side: "south", offset: 70 },
      { id: "east", side: "east", offset: 10 },
    ] as const;
    const graph: LayoutGraph = {
      nodes: [node("a", { ports }), node("b", { ports })],
      edges: [
        { ...edge("e1", "a", "b"), sourcePort: "south" },
        { ...edge("e2", "a", "b"), sourcePort: "east" },
      ],
    };
    const out = layer(graph, options, ranking({ a: 0, b: 1 }));
    // The south port sits 70 from the left of a 100-wide node, so +20 from its centre. The east port is lateral, so it
    // has a dummy and a bundle of its own, and its segment carries no offset.
    expect(out.segments[0].topOffset).toBeCloseTo(20);
    expect(out.segments[0].bottomOffset).toBe(0);
  });

  it("ignores self-loops", () => {
    const graph: LayoutGraph = {
      nodes: [node("a")],
      edges: [edge("loop", "a", "a")],
    };
    const out = layer(graph, options, ranking({ a: 0 }));
    expect(out.bundles).toEqual([]);
    expect(out.nodes).toHaveLength(1);
  });

  it("agrees with the ranking's reversed edges and spans every bundle across adjacent ranks", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const ranked = rank(graph, options);
        const out = layer(graph, options, ranked);
        expectWellFormed(graph, out, ranked);
      }),
      { numRuns: 300 },
    );
  });
});

/** A random graph: n0, n1, ... with edges between them of the kinds above. */
const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 1, max: 8 })
  .chain((count) =>
    fc
      .array(
        fc.tuple(
          fc.nat(count - 1),
          fc.nat(count - 1),
          fc.nat(KIND_NAMES.length - 1),
        ),
        { maxLength: 14 },
      )
      .map((specs) => ({
        nodes: Array.from({ length: count }, (_, i) => node(`n${i}`)),
        edges: specs.map(([a, b, k], i): LayoutEdge => ({
          ...edge(`e${i}`, `n${a}`, `n${b}`),
          kind: KIND_NAMES[k],
        })),
      })),
  );

function expectWellFormed(
  graph: LayoutGraph,
  out: LayeredGraph,
  ranked: RankResult,
): void {
  const rankOf = (id: string) => ranked.ranks.get(id)!;
  for (const e of graph.edges) {
    if (e.source === e.target || KINDS[e.kind].ranks === false) {
      continue;
    }
    const forward = rankOf(e.source) <= rankOf(e.target);
    expect(ranked.reversed.includes(e.id)).toBe(!forward);
  }
  for (const bundle of out.bundles) {
    const { chain } = bundle;
    if (bundle.flat) {
      expect(out.nodes[chain[0]].rank).toBe(out.nodes[chain[1]].rank);
      continue;
    }
    expect(bundle.reversed).toBe(rankOf(bundle.source) > rankOf(bundle.target));
    chain.forEach((x, k) => {
      expect(out.nodes[x].rank).toBe(out.nodes[chain[0]].rank + k);
    });
  }
  out.segments.forEach((s) => {
    expect(out.nodes[s.bottom].rank).toBe(out.nodes[s.top].rank + 1);
  });
}
