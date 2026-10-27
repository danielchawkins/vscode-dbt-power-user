import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import type { RankResult } from "../rank/index.js";
import { rank } from "../rank/index.js";
import { seededRandom, shuffled } from "../random.js";
import type {
  LayoutEdge,
  LayoutGraph,
  LayoutHints,
  LayoutOptions,
} from "../types.js";
import { startingLayers } from "./seed.js";

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

const hint = (rank: number, order: number) => ({ rank, order, x: 0, y: 0 });

describe("startingLayers", () => {
  it("places a new node at the mean of its hinted neighbours", () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: "a", width: 80, height: 40 },
        { id: "b", width: 80, height: 40 },
        { id: "e", width: 80, height: 40 },
        { id: "c", width: 80, height: 40 },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", kind: "dependency" },
        { id: "e2", source: "b", target: "c", kind: "dependency" },
      ],
    };
    const ranking: RankResult = {
      ranks: new Map([
        ["a", 0],
        ["b", 1],
        ["e", 1],
        ["c", 2],
      ]),
      reversed: [],
    };
    const laid = layer(graph, options, ranking);
    // b is new: its neighbours a (order 0) and c (order 4) average to 2, which puts it before e (order 3).
    const hints: LayoutHints = {
      nodes: new Map([
        ["a", hint(0, 0)],
        ["e", hint(1, 3)],
        ["c", hint(2, 4)],
      ]),
    };
    expect(startingLayers(laid, hints)).toEqual([[0], [1, 2], [3]]);
  });

  it("keeps the previous in-rank order of every hinted real node", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const ranked = rank(graph, options);
        const laid = layer(graph, options, ranked);
        const random = seededRandom(seed);
        const hints: LayoutHints = { nodes: new Map() };
        for (let r = 0; r < laid.ranks; r++) {
          const members = graph.nodes.filter(
            (n) => ranked.ranks.get(n.id) === r,
          );
          shuffled(members, random).forEach((n, order) => {
            hints.nodes.set(n.id, hint(r, order));
          });
        }
        const starting = startingLayers(laid, hints);
        starting.forEach((layerNodes) => {
          const real = layerNodes.filter(
            (x) => laid.nodes[x].id !== undefined,
          );
          const orders = real.map((x) => hints.nodes.get(laid.nodes[x].id!)!.order);
          expect(orders).toEqual(orders.toSorted((a, b) => a - b));
        });
      }),
      { numRuns: 200 },
    );
  });

  it("gives each rank a permutation of its nodes when there are no hints", () => {
    fc.assert(
      fc.property(graphArb, (graph) => {
        const laid = layer(graph, options, rank(graph, options));
        const starting = startingLayers(laid, undefined);
        starting.forEach((layerNodes, r) => {
          const members = laid.nodes
            .map((node, x) => (node.rank === r ? x : -1))
            .filter((x) => x >= 0);
          expect(layerNodes.toSorted((a, b) => a - b)).toEqual(members);
        });
      }),
      { numRuns: 200 },
    );
  });
});

const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 1, max: 9 })
  .chain((count) =>
    fc
      .array(fc.tuple(fc.nat(count - 1), fc.nat(count - 1), fc.nat(1)), {
        maxLength: 16,
      })
      .map((specs) => ({
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `n${i}`,
          width: 80,
          height: 40,
        })),
        edges: specs.map(
          ([a, b, k], i): LayoutEdge => ({
            id: `e${i}`,
            source: `n${a}`,
            target: `n${b}`,
            kind: k === 0 ? "dependency" : "column",
          }),
        ),
      })),
  );
