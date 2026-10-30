import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { cappedCounts, showMore } from "./expansionCap";
import type { GraphState } from "./graph";
import { addNeighbours, collapse, drawnGraph, emptyGraph } from "./graph";

const table = (id: string, childCount = 0): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount,
  parentCount: 0,
  tests: [],
});

const ids = (state: GraphState) =>
  drawnGraph(state)
    .tables.map((t) => t.table)
    .sort();

// The hub has five children, given out of label order.
const CHILDREN = ["e", "c", "a", "d", "b"].map((id) => table(id));
const capped = (cap: number) =>
  addNeighbours(
    emptyGraph(table("hub", 5), cap),
    ["children", "hub"],
    CHILDREN,
  );

describe("expansion cap", () => {
  it("draws the first `cap` neighbours by label and counts the rest", () => {
    const state = capped(2);
    expect(ids(state)).toEqual(["a", "b", "hub"]);
    expect(cappedCounts(state)).toEqual({ "c:hub": 3 });
  });

  it("draws every neighbour when the cap is 0 or not reached", () => {
    expect(ids(capped(0))).toHaveLength(6);
    expect(ids(capped(5))).toHaveLength(6);
    expect(cappedCounts(capped(5))).toEqual({});
  });

  it("shows the next batch, then the rest, and then holds nothing back", () => {
    const once = showMore(capped(2), "children", "hub");
    expect(ids(once)).toEqual(["a", "b", "c", "d", "hub"]);
    expect(cappedCounts(once)).toEqual({ "c:hub": 1 });
    const twice = showMore(once, "children", "hub");
    expect(ids(twice)).toHaveLength(6);
    expect(cappedCounts(twice)).toEqual({});
  });

  it("orders tables already drawn first, so a cap does not leave them out", () => {
    const start = emptyGraph(table("hub", 5), 2);
    const withE = { ...start, known: { ...start.known, e: table("e") } };
    // `e` is drawn through another expansion before the hub's children arrive.
    const state = addNeighbours(
      addNeighbours(withE, ["parents", "hub"], [table("e")]),
      ["children", "hub"],
      CHILDREN,
    );
    expect(ids(state)).toEqual(["a", "e", "hub"]);
  });

  it("a collapse leaves no capped count behind", () => {
    const state = collapse(capped(2), "children", "hub");
    expect(ids(state)).toEqual(["hub"]);
    expect(cappedCounts(state)).toEqual({});
  });
});
