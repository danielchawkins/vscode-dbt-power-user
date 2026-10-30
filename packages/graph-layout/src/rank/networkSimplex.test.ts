import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type NetworkEdge, networkSimplex } from "./networkSimplex.js";

const MAX_ITERATIONS = 10_000;

const weightedLength = (
  ranks: readonly number[],
  edges: readonly NetworkEdge[],
): number =>
  edges.reduce((sum, e) => sum + e.weight * (ranks[e.head] - ranks[e.tail]), 0);

const meetsLengths = (
  ranks: readonly number[],
  edges: readonly NetworkEdge[],
): boolean => edges.every((e) => ranks[e.head] - ranks[e.tail] >= e.minLength);

/** The least weighted length over every ranking with values 0 to `top`, by depth-first search with pruning. */
function bruteForceOptimum(
  count: number,
  edges: readonly NetworkEdge[],
  top: number,
): number {
  const finishedAt: NetworkEdge[][] = Array.from({ length: count }, () => []);
  for (const e of edges) {
    finishedAt[Math.max(e.tail, e.head)].push(e);
  }
  const ranks: number[] = Array.from({ length: count }, () => 0);
  let best = Infinity;
  const place = (v: number): void => {
    if (v === count) {
      best = Math.min(best, weightedLength(ranks, edges));
      return;
    }
    for (let r = 0; r <= top; r++) {
      ranks[v] = r;
      if (
        finishedAt[v].every((e) => ranks[e.head] - ranks[e.tail] >= e.minLength)
      ) {
        place(v + 1);
      }
    }
  };
  place(0);
  return best;
}

/** Edges that run from the lower label to the higher, so the constraint graph has no cycle. */
const acyclicEdges = (
  count: number,
  raw: readonly (readonly [number, number, number, number])[],
) =>
  raw
    .filter(([a, b]) => count > 1 && a % count !== b % count)
    .map(([a, b, minLength, weight]): NetworkEdge => {
      const x = a % count;
      const y = b % count;
      return { tail: Math.min(x, y), head: Math.max(x, y), minLength, weight };
    });

const edgeArb = fc.tuple(
  fc.nat(20),
  fc.nat(20),
  fc.integer({ min: 0, max: 1 }),
  fc.integer({ min: 0, max: 3 }),
);

describe("networkSimplex", () => {
  it.each([
    { count: 0, ranks: [] },
    { count: 1, ranks: [0] },
  ])(
    "ranks an edgeless graph of $count node(s) as $ranks",
    ({ count, ranks }) => {
      expect(networkSimplex(count, [], MAX_ITERATIONS)).toEqual(ranks);
    },
  );

  it("puts a chain one rank apart", () => {
    const edges: NetworkEdge[] = [
      { tail: 0, head: 1, minLength: 1, weight: 1 },
      { tail: 1, head: 2, minLength: 1, weight: 1 },
    ];
    expect(networkSimplex(3, edges, MAX_ITERATIONS)).toEqual([0, 1, 2]);
  });

  it("merges parallel edges: weights add and the longest minimum length wins", () => {
    const edges: NetworkEdge[] = [
      { tail: 0, head: 1, minLength: 1, weight: 1 },
      { tail: 0, head: 1, minLength: 3, weight: 2 },
    ];
    expect(networkSimplex(2, edges, MAX_ITERATIONS)).toEqual([0, 3]);
  });

  it("ranks separate components without joining them", () => {
    const ranks = networkSimplex(
      3,
      [{ tail: 1, head: 2, minLength: 2, weight: 1 }],
      MAX_ITERATIONS,
    );
    expect(ranks[2] - ranks[1]).toBe(2);
    expect(Math.min(...ranks)).toBe(0);
  });

  it("refuses a cycle", () => {
    const edges: NetworkEdge[] = [
      { tail: 0, head: 1, minLength: 1, weight: 1 },
      { tail: 1, head: 0, minLength: 1, weight: 1 },
    ];
    expect(() => networkSimplex(2, edges, MAX_ITERATIONS)).toThrow(/cycle/);
  });

  it("stays feasible when the iteration cap stops it at once", () => {
    const edges: NetworkEdge[] = [
      { tail: 0, head: 2, minLength: 1, weight: 1 },
      { tail: 1, head: 2, minLength: 2, weight: 1 },
      { tail: 2, head: 3, minLength: 1, weight: 4 },
    ];
    expect(meetsLengths(networkSimplex(4, edges, 0), edges)).toBe(true);
  });

  it("matches the brute-force optimum on small DAGs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.array(edgeArb, { maxLength: 9 }),
        (count, raw) => {
          const edges = acyclicEdges(count, raw);
          const ranks = networkSimplex(count, edges, MAX_ITERATIONS);
          expect(meetsLengths(ranks, edges)).toBe(true);
          expect(Math.min(...ranks)).toBe(0);
          const top = Math.max(1, count - 1);
          expect(weightedLength(ranks, edges)).toBe(
            bruteForceOptimum(count, edges, top),
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.array(edgeArb, { maxLength: 30 }),
        (count, raw) => {
          const edges = acyclicEdges(count, raw);
          expect(networkSimplex(count, edges, MAX_ITERATIONS)).toEqual(
            networkSimplex(count, edges, MAX_ITERATIONS),
          );
        },
      ),
    );
  });
});
