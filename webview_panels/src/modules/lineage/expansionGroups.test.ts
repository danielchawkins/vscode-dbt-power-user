import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { collapsedGroups, openGroup } from "./expansionGroups";
import type { GraphState } from "./graph";
import { drawnGraph, emptyGraph } from "./graph";
import { groupNodeId } from "./grouping";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 0,
  parentCount: 0,
  tests: [],
});

/** A state with `hub` drawn and the given applied expansions and their buckets, built directly. */
const stateWith = (
  expansions: string[],
  groups: GraphState["groups"],
): GraphState => ({
  ...emptyGraph(table("hub")),
  known: Object.fromEntries(
    ["hub", "other", "x", "y1", "y2", "y3", "z", "z1", "z2"].map((id) => [
      id,
      table(id),
    ]),
  ),
  expansions,
  groups,
});

describe("openGroup", () => {
  // `hub` drawn, with `c:hub` grouped: `models/a` holds x, y1 and y2; `models/b` holds z1 and z2.
  const grouped = (cap: number): GraphState => ({
    ...stateWith(["c:hub"], {
      "c:hub": {
        buckets: [
          { key: "models/a", members: ["x", "y1", "y2"] },
          { key: "models/b", members: ["z1", "z2"] },
        ],
        loose: [],
        open: {},
      },
    }),
    cap,
  });
  const drawn = (state: GraphState) =>
    drawnGraph(state)
      .tables.map((t) => t.table)
      .sort();

  it("draws the first cap members of the group as ordinary cards", () => {
    const state = openGroup(grouped(2), groupNodeId("c:hub", "models/a"));
    expect(drawn(state)).toEqual(["hub", "x", "y1"]);
    expect(collapsedGroups(state).map((g) => g.label)).toEqual(["b"]);
  });

  it("draws every member when there is no cap, or the cap is not smaller", () => {
    const id = groupNodeId("c:hub", "models/a");
    expect(drawn(openGroup(grouped(0), id))).toEqual(["hub", "x", "y1", "y2"]);
    expect(drawn(openGroup(grouped(5), id))).toEqual(["hub", "x", "y1", "y2"]);
  });

  it("leaves the state as it is for an ID that is not a closed bucket of an applied expansion", () => {
    const state = grouped(2);
    expect(openGroup(state, "hub")).toBe(state);
    expect(openGroup(state, groupNodeId("c:other", "models/a"))).toBe(state);
    expect(openGroup(state, groupNodeId("c:hub", "models/none"))).toBe(state);
  });
});

describe("collapsedGroups", () => {
  it("lists the closed buckets of a drawn expansion, with the members they stand for", () => {
    const state = stateWith(["c:hub"], {
      "c:hub": {
        buckets: [
          { key: "models/a", members: ["x", "y1"] },
          { key: "models/b", members: ["y2", "y3"] },
        ],
        loose: ["z"],
        open: {},
      },
    });
    expect(collapsedGroups(state)).toEqual([
      {
        id: groupNodeId("c:hub", "models/a"),
        label: "a",
        count: 2,
        edge: ["hub", groupNodeId("c:hub", "models/a")],
      },
      {
        id: groupNodeId("c:hub", "models/b"),
        label: "b",
        count: 2,
        edge: ["hub", groupNodeId("c:hub", "models/b")],
      },
    ]);
  });

  it("excludes open buckets, whose members are drawn", () => {
    const state = stateWith(["c:hub"], {
      "c:hub": {
        buckets: [
          { key: "models/a", members: ["x", "y1"] },
          { key: "models/b", members: ["y2", "y3"] },
        ],
        loose: ["z"],
        open: { "models/b": 2 },
      },
    });
    expect(collapsedGroups(state).map((g) => g.label)).toEqual(["a"]);
  });

  it("excludes the buckets of an expansion whose table is not drawn", () => {
    const state = stateWith(["c:hub", "c:other"], {
      "c:hub": {
        buckets: [{ key: "models/a", members: ["x", "y1"] }],
        loose: [],
        open: {},
      },
      "c:other": {
        buckets: [{ key: "models/q", members: ["y2", "y3"] }],
        loose: [],
        open: {},
      },
    });
    // `other` is never applied as a drawn neighbour, so its expansion is not drawn.
    expect(collapsedGroups(state).map((g) => g.id)).toEqual([
      groupNodeId("c:hub", "models/a"),
    ]);
  });

  it("sorts groups by id, whatever order the expansions were applied in", () => {
    const state = stateWith(["p:hub", "c:hub"], {
      "p:hub": {
        buckets: [{ key: "pkg:macros", members: ["x", "y1"] }],
        loose: [],
        open: {},
      },
      "c:hub": {
        buckets: [{ key: "models/a", members: ["y2", "y3"] }],
        loose: [],
        open: {},
      },
    });
    const groups = collapsedGroups(state);
    expect(groups.map((g) => g.id)).toEqual(
      [
        groupNodeId("c:hub", "models/a"),
        groupNodeId("p:hub", "pkg:macros"),
      ].sort((a, b) => a.localeCompare(b)),
    );
    expect(groups.map((g) => g.edge)).toEqual([
      ["hub", groupNodeId("c:hub", "models/a")],
      [groupNodeId("p:hub", "pkg:macros"), "hub"],
    ]);
  });
});
