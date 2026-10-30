import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DummyKey, LayeredGraph } from "./layeredGraph.js";
import { runPhases } from "./phases.js";
import type { EdgeKindPolicy, LayoutGraph, LayoutOptions } from "./types.js";

const KINDS: Readonly<Record<string, EdgeKindPolicy>> = {
  dependency: { ranks: true },
  column: { ranks: false, weight: 0.5 },
  relationship: { ranks: false, routed: false },
};
const KIND_NAMES = Object.keys(KINDS);

const portOptions: LayoutOptions = { direction: "down", edgeKinds: KINDS };

/**
 * Random graphs with ports (so lateral port dummies appear), cycles, self-loops that are dropped, parallel edges and
 * clusters (so spines appear). Node `i` sits in cluster `c<k>` when `clusterOf[i]` is below 3.
 */
const portedGraphArb: fc.Arbitrary<LayoutGraph> = fc
  .record({
    count: fc.integer({ min: 2, max: 14 }),
    edges: fc.array(
      fc.record({
        from: fc.nat({ max: 99 }),
        to: fc.nat({ max: 99 }),
        kind: fc.nat({ max: KIND_NAMES.length - 1 }),
        ported: fc.boolean(),
      }),
      { maxLength: 28 },
    ),
    clusterOf: fc.array(fc.nat({ max: 3 }), { minLength: 14, maxLength: 14 }),
  })
  .map(({ count, edges, clusterOf }) => {
    const nodes = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      width: 60,
      height: 30,
      ports: [
        { id: "in", side: "west" as const, offset: 8 },
        { id: "out", side: "east" as const, offset: 8 },
      ],
      ...(clusterOf[i] < 3 ? { cluster: `c${clusterOf[i]}` } : {}),
    }));
    const graphEdges = edges.flatMap((e, i) => {
      const from = e.from % count;
      const to = e.to % count;
      if (from === to) {
        return [];
      }
      return [
        {
          id: `e${i}`,
          source: `n${from}`,
          target: `n${to}`,
          kind: KIND_NAMES[e.kind],
          ...(e.ported ? { sourcePort: "out", targetPort: "in" } : {}),
        },
      ];
    });
    return {
      nodes,
      edges: graphEdges,
      clusters: [{ id: "c0" }, { id: "c1" }, { id: "c2" }],
    };
  });

const keyOf = (key: DummyKey): string =>
  JSON.stringify([key.kind, key.owner, key.rank, key.position]);

/** The keys of every dummy of `layered`, sorted, so two layered graphs compare as sets. */
function dummyKeys(layered: LayeredGraph): string[] {
  return layered.nodes
    .flatMap((node) => (node.id === undefined ? [keyOf(node.key!)] : []))
    .sort();
}

describe("dummy keys", () => {
  it("give every dummy a key, no two dummies one key, and no real node a key", () => {
    fc.assert(
      fc.property(portedGraphArb, (graph) => {
        const { layering } = runPhases(graph, portOptions);
        const keys: string[] = [];
        for (const node of layering.nodes) {
          if (node.id === undefined) {
            expect(node.key).toBeDefined();
            keys.push(keyOf(node.key!));
          } else {
            expect(node.key).toBeUndefined();
          }
        }
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 200 },
    );
  });

  it("key a bundle's chain by its first member edge, the dummy's rank and its position", () => {
    fc.assert(
      fc.property(portedGraphArb, (graph) => {
        const { layering } = runPhases(graph, portOptions);
        for (const bundle of layering.bundles) {
          bundle.chain.forEach((x, position) => {
            const node = layering.nodes[x];
            if (node.id === undefined) {
              expect(node.key).toEqual({
                kind: "edge",
                owner: bundle.edges[0],
                rank: node.rank,
                position,
              });
            }
          });
        }
      }),
      { numRuns: 200 },
    );
  });

  it("keep every key when an unrelated edge is added between two new nodes", () => {
    fc.assert(
      fc.property(portedGraphArb, (graph) => {
        const extended: LayoutGraph = {
          ...graph,
          nodes: [
            ...graph.nodes,
            { id: "x-new", width: 60, height: 30 },
            { id: "y-new", width: 60, height: 30 },
          ],
          edges: [
            ...graph.edges,
            { id: "x-y", source: "x-new", target: "y-new", kind: "dependency" },
          ],
        };
        expect(dummyKeys(runPhases(extended, portOptions).layering)).toEqual(
          dummyKeys(runPhases(graph, portOptions).layering),
        );
      }),
      { numRuns: 200 },
    );
  });
});
