import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import {
  closeGroup,
  collapsedGroups,
  groupChips,
  openGroup,
  restoreGroupId,
  showMoreInGroup,
} from "./expansionGroups";
import type { GraphState } from "./graph";
import { addNeighbours, drawnGraph, emptyGraph } from "./graph";
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

describe("openGroup", () => {
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

describe("restoreGroupId", () => {
  it("reopens a closed bucket of the given applied expansion, as openGroup does", () => {
    const id = groupNodeId("c:hub", "models/b");
    expect(drawn(restoreGroupId(grouped(2), "c:hub", id))).toEqual([
      "hub",
      "z1",
      "z2",
    ]);
    expect(restoreGroupId(grouped(2), "c:hub", id)).toEqual(
      openGroup(grouped(2), id),
    );
  });

  it("leaves the state as it is for a group of another expansion", () => {
    const state = grouped(2);
    expect(
      restoreGroupId(state, "c:other", groupNodeId("c:hub", "models/a")),
    ).toBe(state);
    expect(
      restoreGroupId(state, "c:hub", groupNodeId("c:other", "models/a")),
    ).toBe(state);
  });

  it("leaves the state as it is for an ID that is not a closed bucket", () => {
    const state = grouped(2);
    expect(restoreGroupId(state, "c:hub", "hub")).toBe(state);
    expect(
      restoreGroupId(state, "c:hub", groupNodeId("c:hub", "models/none")),
    ).toBe(state);
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
        layerTags: ["other", "other"],
      },
      {
        id: groupNodeId("c:hub", "models/b"),
        label: "b",
        count: 2,
        edge: ["hub", groupNodeId("c:hub", "models/b")],
        layerTags: ["other", "other"],
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

describe("closeGroup", () => {
  const id = groupNodeId("c:hub", "models/a");
  const opened = openGroup(grouped(2), id);

  it("stops drawing the members of the group, which becomes a closed group again", () => {
    const state = closeGroup(opened, id);
    expect(drawn(state)).toEqual(["hub"]);
    expect(collapsedGroups(state).map((g) => g.id)).toEqual([
      id,
      groupNodeId("c:hub", "models/b"),
    ]);
  });

  it("is idempotent with openGroup: closing then opening again gives the same state", () => {
    expect(openGroup(closeGroup(opened, id), id)).toEqual(opened);
    expect(closeGroup(closeGroup(opened, id), id)).toEqual(
      closeGroup(opened, id),
    );
  });

  it("restores the drawn graph, expansions, column lists and selection, including an expanded member", () => {
    const before = grouped(2);
    // `x` is drawn from the open group; expanding it adds `w`, and its columns are listed and selected.
    const expanded: GraphState = {
      ...addNeighbours(opened, "children", "x", [table("w")]),
      columnTables: ["x"],
      columns: { x: [] },
      selectedTable: "x",
    };
    expect(drawn(expanded)).toEqual(["hub", "w", "x", "y1"]);

    const closed = closeGroup(expanded, id);
    expect(drawnGraph(closed)).toEqual(drawnGraph(before));
    expect(closed.expansions).toEqual(before.expansions);
    expect(closed.columnTables).toEqual(before.columnTables);
    expect(closed.selectedTable).toBeUndefined();
    expect(closed.groups).toEqual(before.groups);
  });

  it("leaves the state as it is for an ID that is not an open group", () => {
    const closed = grouped(2);
    expect(closeGroup(closed, id)).toBe(closed);
    expect(closeGroup(opened, "hub")).toBe(opened);
    expect(closeGroup(opened, groupNodeId("c:other", "models/a"))).toBe(opened);
  });
});

describe("groupChips", () => {
  it("chips each open group of a drawn expansion, with the members it draws and stands for", () => {
    const id = groupNodeId("c:hub", "models/a");
    expect(groupChips(grouped(2))).toEqual([]);
    expect(groupChips(openGroup(grouped(2), id))).toEqual([
      { id, table: "hub", label: "a", drawn: 2, total: 3 },
    ]);
  });

  it("lists parents' chips before children's", () => {
    const state: GraphState = {
      ...stateWith(["c:hub", "p:hub"], {
        "c:hub": {
          buckets: [{ key: "models/a", members: ["x", "y1"] }],
          loose: [],
          open: { "models/a": 2 },
        },
        "p:hub": {
          buckets: [{ key: "models/p", members: ["y2"] }],
          loose: [],
          open: { "models/p": 1 },
        },
      }),
      cap: 0,
    };
    expect(groupChips(state).map((c) => c.label)).toEqual(["p", "a"]);
  });
});

describe("showMoreInGroup", () => {
  const members = Array.from({ length: 88 }, (_, i) => `m${i}`);
  const big = (cap: number): GraphState => ({
    ...stateWith(["c:hub"], {
      "c:hub": {
        buckets: [{ key: "models/big", members }],
        loose: [],
        open: {},
      },
    }),
    known: Object.fromEntries(["hub", ...members].map((id) => [id, table(id)])),
    cap,
  });
  const id = groupNodeId("c:hub", "models/big");

  it("draws the next cap members at each click, ending with all 88 of an 88-member group", () => {
    const drawnIn = (state: GraphState) =>
      groupChips(state).find((chip) => chip.id === id)?.drawn;
    let state = openGroup(big(20), id);
    const shown = [drawnIn(state)];
    for (let click = 0; click < 4; click += 1) {
      state = showMoreInGroup(state, id);
      shown.push(drawnIn(state));
    }
    expect(shown).toEqual([20, 40, 60, 80, 88]);
    expect(drawn(state)).toHaveLength(89);
  });

  it("draws every remaining member when there is no cap", () => {
    const state = showMoreInGroup(openGroup(big(0), id), id);
    expect(groupChips(state)[0]).toMatchObject({ drawn: 88, total: 88 });
  });

  it("leaves the state as it is for an ID that is not an open group", () => {
    const closed = big(20);
    const open = openGroup(closed, id);
    expect(showMoreInGroup(closed, id)).toBe(closed);
    expect(showMoreInGroup(open, "hub")).toBe(open);
  });
});
