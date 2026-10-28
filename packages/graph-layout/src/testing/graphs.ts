import fc from "fast-check";
import { layer } from "../layering.js";
import { createModel, type OrderModel } from "../order/model.js";
import { seededRandom, shuffled } from "../random.js";
import { rank } from "../rank/index.js";
import type {
  LayoutCluster,
  LayoutEdge,
  LayoutGraph,
  LayoutOptions,
} from "../types.js";

// Test-only: the layout options, random graphs and order models that the stage tests share.

export const options: LayoutOptions = {
  direction: "down",
  edgeKinds: {
    dependency: { ranks: true, weight: 1 },
    column: { ranks: false, weight: 0.5 },
  },
};

/** Random graphs of two edge kinds, without ports, on one to nine nodes. */
export const graphArb: fc.Arbitrary<LayoutGraph> = fc
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
        edges: specs.map(([a, b, k], i): LayoutEdge => ({
          id: `e${i}`,
          source: `n${a}`,
          target: `n${b}`,
          kind: k === 0 ? "dependency" : "column",
        })),
      })),
  );

/** Random graphs as `graphArb`, with up to three clusters nested by parent and each node in one of them or in none. */
export const clusteredGraphArb: fc.Arbitrary<LayoutGraph> = fc
  .tuple(
    graphArb,
    fc.array(fc.nat(3), { minLength: 9, maxLength: 9 }),
    fc.array(fc.nat(3), { minLength: 3, maxLength: 3 }),
  )
  .map(([graph, memberOf, parentOf]) =>
    withClusters(graph, memberOf, parentOf),
  );

/**
 * Adds three clusters to `graph`. Node i joins cluster `memberOf[i] % 3` unless that value is 3, which leaves it out.
 * Cluster k is a child of cluster `parentOf[k] - 1` when `parentOf[k] % (k + 1)` is not zero, so parents come first
 * and no cycle can form.
 */
export function withClusters(
  graph: LayoutGraph,
  memberOf: readonly number[],
  parentOf: readonly number[],
): LayoutGraph {
  const clusters = [0, 1, 2].map((k): LayoutCluster => {
    const p = (parentOf[k] ?? 0) % (k + 1);
    return p === 0 ? { id: `c${k}` } : { id: `c${k}`, parent: `c${p - 1}` };
  });
  const nodes = graph.nodes.map((node, i) => {
    const k = memberOf[i] ?? 3;
    return k === 3 ? node : { ...node, cluster: `c${k}` };
  });
  return { ...graph, nodes, clusters };
}

/** A model of `graph` with each rank's order shuffled by `seed`. */
export function randomModel(graph: LayoutGraph, seed: number): OrderModel {
  const laid = layer(graph, options, rank(graph, options));
  const random = seededRandom(seed);
  const layers: number[][] = Array.from({ length: laid.ranks }, () => []);
  laid.nodes.forEach((node, i) => layers[node.rank].push(i));
  return createModel(
    laid,
    layers.map((layerNodes) => shuffled(layerNodes, random)),
  );
}

/** Each rank's node indices in ascending order, whatever order the model holds them in. */
export const sortedRanks = (model: OrderModel) =>
  model.layers.map((l) => l.toSorted((a, b) => a - b));
