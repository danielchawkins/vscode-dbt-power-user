import { expect, it } from "vitest";
import { indexed } from "./indexed.js";
import type { LayoutGraph } from "./types.js";

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
