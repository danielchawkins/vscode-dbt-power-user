import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { collapsedGroups } from "./expansionGroups";
import type { GraphState } from "./graph";
import { emptyGraph } from "./graph";
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
    ["hub", "other", "x", "y1", "y2", "y3", "z"].map((id) => [id, table(id)]),
  ),
  expansions,
  groups,
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
        open: { "models/b": true },
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
