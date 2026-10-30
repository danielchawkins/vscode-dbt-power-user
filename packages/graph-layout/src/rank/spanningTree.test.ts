import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { feasibleTree } from "./feasibleTree.js";
import type { NetworkEdge } from "./networkSimplex.js";
import { SpanningTree } from "./spanningTree.js";

/**
 * A random network on `count` nodes that is connected, acyclic by label, and feasible at ranks equal to the labels.
 * A chain of zero-weight edges guarantees connectivity.
 */
function network(
  count: number,
  raw: readonly (readonly [number, number, number])[],
): NetworkEdge[] {
  const chain = Array.from({ length: count - 1 }, (_, v): NetworkEdge => ({
    tail: v,
    head: v + 1,
    minLength: 0,
    weight: 0,
  }));
  const extra = raw
    .map(([a, b, weight]): NetworkEdge | undefined => {
      const x = a % count;
      const y = b % count;
      if (x === y) {
        return undefined;
      }
      return {
        tail: Math.min(x, y),
        head: Math.max(x, y),
        minLength: 1,
        weight,
      };
    })
    .filter((e): e is NetworkEdge => e !== undefined);
  return [...chain, ...extra];
}

/** The non-tree edge a pivot on `leave` enters by: its tail below the leaving edge, its head above, least index. */
function enteringFor(
  tree: SpanningTree,
  edges: readonly NetworkEdge[],
  leave: number,
): number {
  const child = tree.childOf(leave);
  const headIsChild = child === edges[leave].head;
  return edges.findIndex((x, ei) => {
    if (tree.isTree(ei)) {
      return false;
    }
    const tailBelow = tree.inSubtree(child, x.tail) === headIsChild;
    const headBelow = tree.inSubtree(child, x.head) === headIsChild;
    return tailBelow && !headBelow;
  });
}

describe("SpanningTree", () => {
  it("keeps every incremental cut value equal to a fresh computation across exchanges", () => {
    const raw = fc.array(
      fc.tuple(fc.nat(30), fc.nat(30), fc.integer({ min: 0, max: 3 })),
      { maxLength: 24 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 9 }),
        raw,
        fc.array(fc.nat(100), { maxLength: 12 }),
        (count, pairs, picks) => {
          const edges = network(count, pairs);
          const ranks = Array.from({ length: count }, (_, v) => v);
          let tree = new SpanningTree(
            count,
            edges,
            feasibleTree(count, edges, [...ranks]),
          );
          for (const pick of picks) {
            const list = tree.treeEdges;
            const leave = list[pick % list.length];
            const enter = enteringFor(tree, edges, leave);
            if (enter < 0) {
              continue;
            }
            tree.exchange(leave, enter);
            const fresh = new SpanningTree(count, edges, tree.treeEdges);
            for (const f of tree.treeEdges) {
              // Adding zero turns a negative zero into zero, so the comparison is on values alone.
              expect({ f, cut: tree.cut(f) + 0 }).toEqual({
                f,
                cut: fresh.cut(f) + 0,
              });
            }
          }
          tree = new SpanningTree(count, edges, tree.treeEdges);
        },
      ),
      { numRuns: 200 },
    );
  });
});
