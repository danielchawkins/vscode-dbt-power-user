import { describe, expect, it } from "vitest";
import { order } from "../order/index.js";
import { rank } from "../rank/index.js";
import type { LayoutGraph, LayoutOptions } from "../types.js";
import { place } from "./index.js";

const optionsWithNodeSpacing: LayoutOptions = {
  direction: "down",
  edgeKinds: { dependency: { ranks: true, weight: 1 } },
  spacing: { node: 40 },
};

/** Two cards in one rank, `a` with a west port whose stub runs to a dummy beside it, and `b` beside `a`. */
const graph: LayoutGraph = {
  nodes: ["a", "b", "c", "x"].map((id) => ({
    id,
    width: 100,
    height: 60,
    ports: id === "a" ? [{ id: "p", side: "west", offset: 10 }] : undefined,
  })),
  edges: [
    { id: "e1", source: "a", target: "c", kind: "dependency", sourcePort: "p" },
    { id: "e2", source: "b", target: "c", kind: "dependency" },
    { id: "e3", source: "x", target: "a", kind: "dependency" },
    { id: "e4", source: "x", target: "b", kind: "dependency" },
  ],
};

describe("place lateral ports", () => {
  it("keeps two cards of different blocks node spacing apart when a lateral port dummy sits between them", () => {
    const placed = place(
      graph,
      optionsWithNodeSpacing,
      order(graph, optionsWithNodeSpacing, rank(graph, optionsWithNodeSpacing)),
    ).nodes;
    const [first, second] = ["a", "b"]
      .map((id) => ({ id, centre: placed.get(id)! }))
      .sort((p, q) => p.centre.x - q.centre.x);
    const gap = second.centre.x - 50 - (first.centre.x + 50);
    expect(gap).toBeGreaterThanOrEqual(40 - 1e-6);
  });
});
