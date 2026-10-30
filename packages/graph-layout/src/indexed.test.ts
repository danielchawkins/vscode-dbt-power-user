import fc from "fast-check";
import { expect, it } from "vitest";
import { indexed } from "./indexed.js";
import type { EdgeKindPolicy, LayoutEdge, LayoutGraph } from "./types.js";

const graph: LayoutGraph = {
  nodes: [
    { id: "a", width: 10, height: 10, cluster: "outer" },
    { id: "b", width: 10, height: 10 },
    { id: "c", width: 10, height: 10, cluster: "inner" },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", kind: "k" },
    { id: "e2", source: "b", target: "c", kind: "k" },
  ],
  clusters: [{ id: "outer" }, { id: "inner", parent: "outer" }],
};

it("maps each id to its index, node, edge, cluster and innermost cluster", () => {
  const input = indexed(graph);
  expect([...input.nodeIndex]).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 2],
  ]);
  expect(input.nodeById.get("c")).toBe(graph.nodes[2]);
  expect(input.edgeById.get("e2")).toBe(graph.edges[1]);
  expect([...input.clusterIndex]).toEqual([
    ["outer", 0],
    ["inner", 1],
  ]);
  expect([...input.clusterParent]).toEqual([
    ["outer", undefined],
    ["inner", "outer"],
  ]);
  expect([...input.innermost]).toEqual([
    ["a", "outer"],
    ["b", undefined],
    ["c", "inner"],
  ]);
});

it("returns an indexed input unchanged, and indexes a graph without clusters", () => {
  const input = indexed(graph);
  expect(indexed(input)).toBe(input);
  const bare = indexed({ nodes: [], edges: [] });
  expect(bare.clusterIndex.size).toBe(0);
  expect(bare.nodeIndex.size).toBe(0);
});

const POLICIES: Readonly<Record<string, EdgeKindPolicy>> = {
  dependency: { ranks: true },
  column: { ranks: false },
  relationship: { ranks: false, routed: false },
};
const KIND_NAMES = Object.keys(POLICIES);

/** Random graphs of up to twelve nodes, with edges of every policy among them, self-loops and parallel edges included. */
const policyGraphArb: fc.Arbitrary<LayoutGraph> = fc
  .record({
    count: fc.integer({ min: 1, max: 12 }),
    edges: fc.array(
      fc.record({
        from: fc.nat({ max: 99 }),
        to: fc.nat({ max: 99 }),
        kind: fc.nat({ max: KIND_NAMES.length - 1 }),
      }),
      { maxLength: 20 },
    ),
  })
  .map(({ count, edges }) => ({
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      width: 10,
      height: 10,
    })),
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      source: `n${e.from % count}`,
      target: `n${e.to % count}`,
      kind: KIND_NAMES[e.kind],
    })),
  }));

/**
 * The component number of each node, by brute force: every node starts in a component of its own, and each joining
 * edge relabels both ends' components to one label. Numbers are assigned in the order of each component's first node.
 */
function bruteForce(
  graph: LayoutGraph,
  joins: (edge: LayoutEdge) => boolean,
): number[] {
  let label = graph.nodes.map((_, i) => i);
  for (const edge of graph.edges) {
    if (!joins(edge)) {
      continue;
    }
    const a = graph.nodes.findIndex((n) => n.id === edge.source);
    const b = graph.nodes.findIndex((n) => n.id === edge.target);
    const from = label[a];
    const to = label[b];
    label = label.map((l) => (l === from ? to : l));
  }
  const ids = new Map<number, number>();
  return label.map((l) => {
    if (!ids.has(l)) {
      ids.set(l, ids.size);
    }
    return ids.get(l)!;
  });
}

it("numbers the components as a brute-force union-find does, over the ranking and routed edges", () => {
  fc.assert(
    fc.property(policyGraphArb, (graph) => {
      const joins = (edge: LayoutEdge) =>
        POLICIES[edge.kind].ranks || POLICIES[edge.kind].routed !== false;
      const expected = bruteForce(graph, joins);
      const ids = indexed(graph, { edgeKinds: POLICIES }).component;
      expect(graph.nodes.map((n) => ids.get(n.id))).toEqual(expected);
      const used = [...new Set(expected)].sort((x, y) => x - y);
      expect(used).toEqual(used.map((_, k) => k));
    }),
    { numRuns: 300 },
  );
});

it("joins every edge when no policy is given", () => {
  fc.assert(
    fc.property(policyGraphArb, (graph) => {
      const ids = indexed(graph).component;
      expect(graph.nodes.map((n) => ids.get(n.id))).toEqual(
        bruteForce(graph, () => true),
      );
    }),
    { numRuns: 100 },
  );
});

it("leaves out an edge that neither ranks nor is routed", () => {
  const graph: LayoutGraph = {
    nodes: [
      { id: "a", width: 10, height: 10 },
      { id: "b", width: 10, height: 10 },
      { id: "c", width: 10, height: 10 },
    ],
    edges: [
      { id: "r", source: "a", target: "b", kind: "relationship" },
      { id: "d", source: "b", target: "c", kind: "dependency" },
    ],
  };
  expect([...indexed(graph, { edgeKinds: POLICIES }).component]).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 1],
  ]);
  expect([...indexed(graph).component]).toEqual([
    ["a", 0],
    ["b", 0],
    ["c", 0],
  ]);
});
