import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import { seededRandom, shuffled } from "../random.js";
import type { RankResult } from "../rank/index.js";
import { rank } from "../rank/index.js";
import { graphArb, options } from "../testing/graphs.js";
import type { LayoutGraph, LayoutHints } from "../types.js";
import { startingLayers } from "./seed.js";

const hint = (rank: number, order: number) => ({ rank, order, x: 0, y: 0 });

describe("startingLayers", () => {
  it("places a new node by its neighbours' places in their ranks, not by their raw orders", () => {
    const graph: LayoutGraph = {
      nodes: [
        { id: "a", width: 80, height: 40 },
        { id: "b", width: 80, height: 40 },
        { id: "e", width: 80, height: 40 },
        { id: "g", width: 80, height: 40 },
        { id: "c", width: 80, height: 40 },
        { id: "d", width: 80, height: 40 },
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
        ["g", 1],
        ["c", 2],
        ["d", 2],
      ]),
      reversed: [],
    };
    const laid = layer(graph, options, ranking);
    // b is new. Its neighbours a (the only node of rank 0) and c (the first of rank 2) sit at 0.5 and 0.25 of their
    // ranks, so b falls at 0.375 of rank 1, between e (0.25) and g (0.75). Their raw orders (0 and 4) would put b first.
    const hints: LayoutHints = {
      nodes: new Map([
        ["a", hint(0, 0)],
        ["e", hint(1, 3)],
        ["g", hint(1, 9)],
        ["c", hint(2, 4)],
        ["d", hint(2, 5)],
      ]),
    };
    const ids = startingLayers(laid, hints).map((layerNodes) =>
      layerNodes.map((x) => laid.nodes[x].id),
    );
    expect(ids).toEqual([["a"], ["e", "b", "g"], ["c", "d"]]);
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
          const real = layerNodes.filter((x) => laid.nodes[x].id !== undefined);
          const orders = real.map(
            (x) => hints.nodes.get(laid.nodes[x].id!)!.order,
          );
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
