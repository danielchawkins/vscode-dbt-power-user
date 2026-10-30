import { describe, expect, it } from "vitest";
import { order } from "../order/index.js";
import { rank } from "../rank/index.js";
import { boxViolations } from "../testing/boxes.js";
import { options } from "../testing/graphs.js";
import { routeGraph } from "../testing/routeGraphs.js";
import type { LayoutGraph, LayoutOptions, Rect } from "../types.js";
import { place } from "./index.js";

const NONE = {
  members: [],
  nested: [],
  siblings: [],
  nodes: [],
  strangers: [],
};

const opts: LayoutOptions = { ...options, effort: "balanced" };

function placed(graph: LayoutGraph) {
  return place(graph, opts, order(graph, opts, rank(graph, opts)));
}

/** The placed drawing and the routed one, each checked against every box rule. */
function drawings(graph: LayoutGraph) {
  const result = placed(graph);
  const routed = routeGraph(graph, opts);
  return [
    boxViolations(graph, result.nodes, result.clusters),
    boxViolations(graph, routed.nodes, routed.clusters),
  ];
}

const node = (id: string, cluster?: string) => ({
  id,
  width: 40,
  height: 20,
  ...(cluster === undefined ? {} : { cluster }),
});

const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  kind: "dependency",
});

/** Whether two rectangles share some x, touching edges not counting. */
function sharesX(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

describe("cluster boxes follow Graphviz's rules", () => {
  it("lets sibling boxes with disjoint rank spans share x", () => {
    const graph: LayoutGraph = {
      nodes: [node("a", "A"), node("b", "B")],
      edges: [edge("e", "a", "b")],
      clusters: [{ id: "A" }, { id: "B" }],
    };
    const result = placed(graph);
    expect(boxViolations(graph, result.nodes, result.clusters)).toEqual(NONE);
    expect(sharesX(result.clusters.get("A")!, result.clusters.get("B")!)).toBe(
      true,
    );
  });

  it("keeps sibling boxes on adjacent ranks apart, with padding and a label", () => {
    const graph: LayoutGraph = {
      nodes: [node("a", "A"), node("b", "B")],
      edges: [edge("e", "a", "b")],
      clusters: [
        { id: "A", padding: 30 },
        { id: "B", padding: 30, labelHeight: 20 },
      ],
    };
    expect(drawings(graph)).toEqual([NONE, NONE]);
  });

  it("keeps one box for a cluster that skips a middle rank, holding its members in both ranks", () => {
    const graph: LayoutGraph = {
      nodes: [node("c0", "C"), node("m"), node("c2", "C")],
      edges: [edge("e1", "c0", "m"), edge("e2", "m", "c2")],
      clusters: [{ id: "C" }],
    };
    const result = placed(graph);
    expect([...result.clusters.keys()]).toEqual(["C"]);
    expect(drawings(graph)).toEqual([NONE, NONE]);
  });

  it("keeps a nested box inside its parent with the parent's padding", () => {
    const graph: LayoutGraph = {
      nodes: [node("a", "K"), node("p", "P")],
      edges: [edge("e", "p", "a")],
      clusters: [
        { id: "P", padding: 12 },
        { id: "K", parent: "P" },
      ],
    };
    const result = placed(graph);
    expect(boxViolations(graph, result.nodes, result.clusters)).toEqual(NONE);
  });
});
