import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { GraphState } from "./graph";
import { addNeighbours, drawnGraph, emptyGraph, lineageData } from "./graph";

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

// The start S has children H (hidden) and C; H has child X. S -> C is the only edge that should be drawn.
function sample(startHidden = false): GraphState {
  const start = emptyGraph(table("S", { hidden: startHidden }));
  const withChildren = addNeighbours(start, "children", "S", [
    table("H", { hidden: true }),
    table("C"),
  ]);
  return addNeighbours(withChildren, "children", "H", [table("X")]);
}

describe("hidden nodes", () => {
  it("draws a hidden node but no table edge into or out of it", () => {
    const { tables, edges } = drawnGraph(sample());
    expect(tables.map((t) => t.table)).toContain("H");
    expect(edges).toEqual([["S", "C"]]);
  });

  it("still draws the neighbours an expansion of a hidden node adds", () => {
    expect(drawnGraph(sample()).tables.map((t) => t.table)).toContain("X");
  });

  it("never treats the start table as hidden", () => {
    expect(drawnGraph(sample(true)).edges).toContainEqual(["S", "C"]);
  });

  it("drops column edges that touch a hidden table", () => {
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
});
