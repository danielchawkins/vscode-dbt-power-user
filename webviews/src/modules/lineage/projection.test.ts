import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { addNeighbours, emptyGraph, NEIGHBOURHOOD_VIEW } from "./graph";
import type { GraphState } from "./graphState";
import { visibleOf } from "./projection";

const table = (
  id: string,
  childCount = 0,
  parentCount = 0,
): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount,
  parentCount,
  tests: [],
});

const withView = (
  state: GraphState,
  view: Partial<GraphState["view"]>,
): GraphState => ({ ...state, view: { ...NEIGHBOURHOOD_VIEW, ...view } });

/** The drawn cards, sorted, so an assertion does not depend on the order the projection builds them in. */
const drawnOf = (state: GraphState): string[] =>
  [...visibleOf(state).drawn].toSorted();

describe("the neighbourhood projection", () => {
  // Start b: parents a and d, child c. a has one child; d has one child; c has one parent.
  const start = table("b", 1, 2);
  const around = (budget: number, d = table("d", 1, 0)) =>
    withView(
      addNeighbours(
        addNeighbours(
          emptyGraph(start),
          ["parents", "b"],
          [table("a", 1, 0), d],
        ),
        ["children", "b"],
        [table("c", 0, 1)],
      ),
      { cardBudget: budget },
    );

  it("keeps the start and every neighbour within the budget, and marks the rest capped", () => {
    // Budget 3 keeps the start and two neighbours; all three neighbours tie on distance and degree, so ID decides.
    const state = around(3);
    expect(drawnOf(state)).toEqual(["a", "b", "c"]);
    expect(visibleOf(state).capped).toEqual({ "p:b": 1 });
  });

  it("ranks by connection count before ID", () => {
    // d has five children, so it outranks a and c, which have one connection each.
    const state = around(2, table("d", 5, 0));
    expect(drawnOf(state)).toEqual(["b", "d"]);
    expect(visibleOf(state).capped).toEqual({ "p:b": 1, "c:b": 1 });
  });

  it("ranks by distance before connection count", () => {
    // e is busy but two steps from the start, past the first ring of a, c and d.
    const state = withView(
      addNeighbours(
        around(3, table("d", 1, 0)),
        ["children", "c"],
        [table("e", 0, 1)],
      ),
      { cardBudget: 3 },
    );
    expect(drawnOf(state)).toEqual(["a", "b", "c"]);
    expect(visibleOf(state).capped).toEqual({ "p:b": 1, "c:c": 1 });
  });

  it("draws the whole neighbourhood when the budget covers it", () => {
    const state = around(150);
    expect(drawnOf(state)).toEqual(["a", "b", "c", "d"]);
    expect(visibleOf(state).capped).toEqual({});
  });

  it("leaves out a card one step past the depth until a manual expansion draws it", () => {
    // e is a parent of a, two steps from b. The depths expand only b, so e is not in the default graph; a manual
    // expansion of a draws it past the depth.
    const around2 = around(150);
    expect(drawnOf(around2)).not.toContain("e");
    const manual = addNeighbours(around2, ["parents", "a"], [table("e", 0, 1)]);
    expect(drawnOf(manual)).toContain("e");
  });
});

describe("the whole-project projection", () => {
  // a -> b -> c, and x is a project table no path reaches; start a.
  const project = () =>
    withView(
      {
        ...addNeighbours(
          addNeighbours(
            emptyGraph(table("a", 1, 0)),
            ["children", "a"],
            [table("b", 1, 1)],
          ),
          ["children", "b"],
          [table("c", 0, 1)],
        ),
        project: ["a", "b", "c", "x"],
      },
      { viewMode: "whole" },
    );

  it("draws every project table", () => {
    expect(drawnOf(project())).toEqual(["a", "b", "c", "x"]);
  });

  it("keeps a card that another path reaches, though a hidden card lies on one path to it", () => {
    // a -> b -> c and x -> c: with b hidden, c still has the path from x, so it stays, and so does x.
    const state = {
      ...withView(
        {
          ...project(),
          links: { "b\0c": ["b", "c"], "x\0c": ["x", "c"] },
        },
        { viewMode: "whole" },
      ),
      hiddenCards: [{ id: "b" }],
    };
    expect(drawnOf(state)).toEqual(["a", "c", "x"]);
  });

  it("leaves out a card only hidden cards lead to from a source", () => {
    // a -> b -> c with nothing else: with b hidden, c is reached only through b, so it goes.
    const chain = withView(
      { ...project(), project: ["a", "b", "c"] },
      { viewMode: "whole" },
    );
    const state = { ...chain, hiddenCards: [{ id: "b" }] };
    expect(drawnOf(state)).toEqual(["a"]);
  });
});
