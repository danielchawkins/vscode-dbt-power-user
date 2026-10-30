import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AcyclicEdge, reversedEdges } from "./acyclic.js";

const edge = (id: string, source: string, target: string): AcyclicEdge => ({
  id,
  source,
  target,
});

/** Kahn's algorithm: true when the edges have no cycle. */
function isAcyclic(edges: readonly AcyclicEdge[]): boolean {
  const indegree = new Map<string, number>();
  for (const e of edges) {
    indegree.set(e.source, indegree.get(e.source) ?? 0);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }
  const queue = [...indegree].filter(([, d]) => d === 0).map(([n]) => n);
  let removed = 0;
  while (queue.length > 0) {
    const n = queue.pop()!;
    removed++;
    for (const e of edges) {
      if (e.source !== n) {
        continue;
      }
      const d = indegree.get(e.target)! - 1;
      indegree.set(e.target, d);
      if (d === 0) {
        queue.push(e.target);
      }
    }
  }
  return removed === indegree.size;
}

describe("reversedEdges", () => {
  it("reverses nothing in a graph that is already acyclic", () => {
    const edges = [
      edge("a", "x", "y"),
      edge("b", "y", "z"),
      edge("c", "x", "z"),
    ];
    expect(reversedEdges(edges)).toEqual([]);
  });

  it("reverses one edge of a two-cycle", () => {
    const edges = [edge("ab", "a", "b"), edge("ba", "b", "a")];
    expect(reversedEdges(edges)).toHaveLength(1);
  });

  it("breaks a triangle with a single reversal", () => {
    const edges = [
      edge("ab", "a", "b"),
      edge("bc", "b", "c"),
      edge("ca", "c", "a"),
    ];
    const reversed = reversedEdges(edges);
    expect(reversed).toHaveLength(1);
    const rest = edges.filter((e) => !reversed.includes(e.id));
    expect(isAcyclic(rest)).toBe(true);
  });

  it("never reports a self-loop", () => {
    const edges = [edge("loop", "a", "a"), edge("ab", "a", "b")];
    expect(reversedEdges(edges)).toEqual([]);
  });

  it("reverses the first listed of two opposing edges", () => {
    const edges = [
      edge("first", "b", "a"),
      edge("ab", "a", "b"),
      edge("second", "a", "b"),
    ];
    expect(reversedEdges(edges)).toEqual(["first"]);
  });

  it("is a pure function of its input", () => {
    const edges = [
      edge("1", "p", "q"),
      edge("2", "q", "r"),
      edge("3", "r", "p"),
      edge("4", "q", "p"),
    ];
    expect(reversedEdges(edges)).toEqual(reversedEdges(edges));
  });

  it("leaves an acyclic graph once the reversed edges are removed", () => {
    const pair = fc.tuple(
      fc.integer({ min: 0, max: 7 }),
      fc.integer({ min: 0, max: 7 }),
    );
    fc.assert(
      fc.property(fc.array(pair, { maxLength: 24 }), (pairs) => {
        const edges = pairs.map(([s, t], i) => edge(`e${i}`, `n${s}`, `n${t}`));
        const reversed = new Set(reversedEdges(edges));
        // Self-loops are never reversed; they sit outside the ordering, so the check leaves them out.
        const rest = edges.filter(
          (e) => !reversed.has(e.id) && e.source !== e.target,
        );
        expect(isAcyclic(rest)).toBe(true);
      }),
    );
  });

  it("reports only ids of the input, each once", () => {
    const pair = fc.tuple(
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
    );
    fc.assert(
      fc.property(fc.array(pair, { maxLength: 20 }), (pairs) => {
        const edges = pairs.map(([s, t], i) => edge(`e${i}`, `n${s}`, `n${t}`));
        const reversed = reversedEdges(edges);
        expect(new Set(reversed).size).toBe(reversed.length);
        const ids = new Set(edges.map((e) => e.id));
        expect(reversed.every((id) => ids.has(id))).toBe(true);
      }),
    );
  });
});
