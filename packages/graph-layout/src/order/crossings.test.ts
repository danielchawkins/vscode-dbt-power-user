import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layer } from "../layering.js";
import { seededRandom, shuffled } from "../random.js";
import { rank } from "../rank/index.js";
import type { LayoutEdge, LayoutGraph, LayoutOptions } from "../types.js";
import { pairCrossings, totalCrossings } from "./crossings.js";
import { createModel, type OrderModel, setLayer, slot } from "./model.js";

type Link = readonly [upper: number, lower: number, weight: number];

const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

/** Two links cross when their order differs strictly at both ranks; the weight of a crossing is the two weights' product. */
function bruteForce(links: readonly Link[]): number {
  let total = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      const [ua, la, wa] = links[i];
      const [ub, lb, wb] = links[j];
      if ((ua - ub) * (la - lb) < 0) {
        total += wa * wb;
      }
    }
  }
  return total;
}

describe("totalCrossings", () => {
  it("equals a brute-force count over the segments of each pair of adjacent ranks", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const model = randomModel(graph, seed);
        const { segments } = model.graph;
        const byRank = new Map<number, Link[]>();
        for (const s of segments) {
          const rank = model.graph.nodes[s.top].rank;
          const links = byRank.get(rank) ?? [];
          links.push([
            slot(model, s.top, s.topOffset),
            slot(model, s.bottom, s.bottomOffset),
            s.weight,
          ]);
          byRank.set(rank, links);
        }
        const expected = [...byRank.values()].reduce(
          (sum, links) => sum + bruteForce(links),
          0,
        );
        expect(totalCrossings(model)).toBeCloseTo(expected, 9);
      }),
      { numRuns: 300 },
    );
  });

  it("changes by the pair counts when two neighbours in one rank swap", () => {
    fc.assert(
      fc.property(graphArb, fc.integer(), (graph, seed) => {
        const model = randomModel(graph, seed);
        for (let rank = 0; rank < model.layers.length; rank++) {
          const layer = model.layers[rank];
          for (let k = 0; k + 1 < layer.length; k++) {
            const a = layer[k];
            const b = layer[k + 1];
            const before = totalCrossings(model);
            const expected =
              before + pairCrossings(model, b, a) - pairCrossings(model, a, b);
            const swapped = [...layer];
            swapped[k] = b;
            swapped[k + 1] = a;
            setLayer(model, rank, swapped);
            expect(totalCrossings(model)).toBeCloseTo(expected, 9);
            setLayer(model, rank, layer);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

/** Random graphs of the two kinds, with ports on some edges, on up to nine nodes. */
const graphArb: fc.Arbitrary<LayoutGraph> = fc
  .integer({ min: 1, max: 9 })
  .chain((count) =>
    fc
      .array(
        fc.tuple(fc.nat(count - 1), fc.nat(count - 1), fc.nat(1), fc.boolean()),
        { maxLength: 16 },
      )
      .map((specs) => ({
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `n${i}`,
          width: 80,
          height: 40,
          ports: [{ id: "p", side: "south" as const, offset: 60 }],
        })),
        edges: specs.map(([a, b, k, port], i): LayoutEdge => ({
          id: `e${i}`,
          source: `n${a}`,
          target: `n${b}`,
          kind: k === 0 ? "dependency" : "column",
          sourcePort: port ? "p" : undefined,
        })),
      })),
  );

/** A model of `graph` with each rank's order shuffled by `seed`. */
function randomModel(graph: LayoutGraph, seed: number): OrderModel {
  const ranked = rank(graph, options);
  const laid = layer(graph, options, ranked);
  const random = seededRandom(seed);
  const layers: number[][] = Array.from({ length: laid.ranks }, () => []);
  laid.nodes.forEach((node, i) => layers[node.rank].push(i));
  return createModel(
    laid,
    layers.map((layerNodes) => shuffled(layerNodes, random)),
  );
}
