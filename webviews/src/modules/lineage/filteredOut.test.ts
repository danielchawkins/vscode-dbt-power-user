import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { GraphState } from "./graph";
import { addNeighbours, drawnGraph, emptyGraph, visibleOf } from "./graph";
import { lineageData } from "./visibility";

const table = (
  id: string,
  over: Partial<lineage.LineageTable> = {},
): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 1,
  parentCount: 1,
  tests: [],
  ...over,
});

// The start S has children H (filtered out) and C; H has child X. S -> C is the only edge that should be drawn.
function sample(startFilteredOut = false): GraphState {
  const start = emptyGraph(table("S", { hidden: startFilteredOut }));
  const withChildren = addNeighbours(start, "children", "S", [
    table("H", { hidden: true }),
    table("C"),
  ]);
  return addNeighbours(withChildren, "children", "H", [table("X")]);
}

describe("filtered-out tables", () => {
  it("draws a filtered-out table but no table edge into or out of it", () => {
    const { tables, edges } = drawnGraph(sample());
    expect(tables.map((t) => t.table)).toContain("H");
    expect(edges).toEqual([["S", "C"]]);
  });

  it("still draws the neighbours an expansion of a filtered-out table adds", () => {
    expect(drawnGraph(sample()).tables.map((t) => t.table)).toContain("X");
  });

  it("never treats the start table as filtered out", () => {
    expect(drawnGraph(sample(true)).edges).toContainEqual(["S", "C"]);
  });

  it("drops column edges that touch a filtered-out table", () => {
    const state: GraphState = {
      ...sample(),
      columnEdges: [
        { source: ["S", "id"], target: ["H", "id"], type: "direct" },
        { source: ["H", "id"], target: ["X", "id"], type: "direct" },
        { source: ["S", "id"], target: ["C", "id"], type: "direct" },
      ],
    };
    const { columnEdges } = lineageData(state, {
      direct: true,
      indirect: true,
    });
    expect(columnEdges).toEqual([
      { source: ["S", "id"], target: ["C", "id"], type: "direct" },
    ]);
  });

  it("reads one Visible Graph, so the cards and the edges agree", () => {
    const state = sample();
    const visible = visibleOf(state);
    const { tables, edges } = drawnGraph(state);
    expect(tables.map((t) => t.table)).toEqual([...visible.drawn]);
    expect(visible.filteredOut).toEqual(new Set(["H"]));
    for (const [parent, child] of edges) {
      expect(visible.hasEdges(parent)).toBe(true);
      expect(visible.hasEdges(child)).toBe(true);
    }
    expect(visible.hasEdges("H")).toBe(false);
    expect(visible.hasEdges("C")).toBe(true);
  });
});
