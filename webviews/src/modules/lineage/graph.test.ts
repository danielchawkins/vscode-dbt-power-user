import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it, vi } from "vitest";
import { traceColumn } from "./columnTrace";
import { expandLevels, replayExpansions } from "./expansionBatch";
import type { GraphState, GraphStore } from "./graph";
import {
  addNeighbours,
  collapse,
  columnClick,
  drawnGraph,
  emptyGraph,
  expand,
  expansionClick,
  hideColumns,
  lineageData,
  linkDrawn,
  parseExpansion,
  showColumns,
} from "./graph";
import { groupNodeId } from "./grouping";
import { columnHandle } from "./layout";

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

// a -> b -> c, and d -> b.
const TABLES = {
  a: table("a", 1, 0),
  b: table("b", 1, 2),
  c: table("c", 0, 1),
  d: table("d", 1, 0),
};
const CHILDREN: Record<string, string[]> = { a: ["b"], b: ["c"], d: ["b"] };
const PARENTS: Record<string, string[]> = { b: ["a", "d"], c: ["b"] };

const fetchNeighbours = vi.fn(
  async (direction: "children" | "parents", id: string) =>
    (direction === "children" ? CHILDREN : PARENTS)[id]?.map(
      (n) => TABLES[n as keyof typeof TABLES],
    ) ?? [],
);

const storeOf = (state: GraphState): GraphStore => {
  let current = state;
  return {
    get: () => current,
    update: (change) => {
      current = change(current);
    },
  };
};

const ids = (state: GraphState) =>
  drawnGraph(state)
    .tables.map((t) => t.table)
    .sort();

describe("lineage graph", () => {
  it("draws the start table alone before any expansion", () => {
    expect(drawnGraph(emptyGraph(TABLES.b))).toEqual({
      tables: [TABLES.b],
      edges: [],
    });
  });

  it("expands one level of parents and children through childTables and parentTables", async () => {
    const store = storeOf(emptyGraph(TABLES.b));
    await expandLevels(store, 1, fetchNeighbours);
    expect(ids(store.get())).toEqual(["a", "b", "c", "d"]);
    expect(drawnGraph(store.get()).edges).toEqual(
      expect.arrayContaining([
        ["a", "b"],
        ["d", "b"],
        ["b", "c"],
      ]),
    );
    expect(store.get().expansions).toEqual(["p:b", "c:b"]);
  });

  it("does not ask for neighbours a count says do not exist", async () => {
    fetchNeighbours.mockClear();
    const store = storeOf(emptyGraph(TABLES.a));
    expect(await expand(store, "parents", "a", fetchNeighbours)).toEqual([]);
    expect(fetchNeighbours).not.toHaveBeenCalled();
  });

  it("collapse removes tables drawn only through that expansion and their column state", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    await expand(store, "children", "a", fetchNeighbours);
    await expand(store, "children", "b", fetchNeighbours);
    await showColumns(store, ["c"], async () => [{ table: "c", name: "id" }]);
    store.update((s) => ({ ...s, selectedTable: "c" }));
    const collapsed = collapse(store.get(), "children", "a");
    expect(ids(collapsed)).toEqual(["a"]);
    expect(collapsed.expansions).toEqual([]);
    expect(collapsed.columnTables).toEqual([]);
    expect(collapsed.selectedTable).toBeUndefined();
  });

  it("replays saved expansions in order and skips one whose table is not drawn", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    await replayExpansions(
      store,
      { expansions: ["c:b", "c:a", "c:b", "x:a"], openGroups: [] },
      fetchNeighbours,
    );
    expect(store.get().expansions).toEqual(["c:a", "c:b"]);
    expect(ids(store.get())).toEqual(["a", "b", "c"]);
    expect(parseExpansion("x:a")).toBeUndefined();
  });

  describe("replay of open groups", () => {
    // `hub` has four children in two folders, so with a cap of 2 they bucket into two closed groups. `m1` has child `z`.
    const member = (id: string, path: string, childCount = 0) => ({
      ...table(id, childCount, 1),
      path,
    });
    const GROUPED: Record<string, lineage.LineageTable[]> = {
      hub: [
        member("m1", "models/x/m1.sql", 1),
        member("m2", "models/x/m2.sql"),
        member("m3", "models/y/m3.sql"),
        member("m4", "models/y/m4.sql"),
      ],
      m1: [table("z")],
    };
    const fetchGrouped = vi.fn(
      async (direction: "children" | "parents", id: string) =>
        direction === "children" ? (GROUPED[id] ?? []) : [],
    );
    const hubStore = () => storeOf(emptyGraph(table("hub", 4, 0), 2, "folder"));

    it("reopens a group right after its expansion, so a member's saved expansion replays", async () => {
      const store = hubStore();
      await replayExpansions(
        store,
        {
          expansions: ["c:hub", "c:m1"],
          openGroups: [groupNodeId("c:hub", "pkg:models/x")],
        },
        fetchGrouped,
      );
      expect(store.get().groups["c:hub"]?.open).toEqual({ "pkg:models/x": 2 });
      expect(store.get().expansions).toEqual(["c:hub", "c:m1"]);
      expect(ids(store.get())).toEqual(["hub", "m1", "m2", "z"]);
    });

    it("ignores a saved group ID whose group no longer exists", async () => {
      const store = hubStore();
      await replayExpansions(
        store,
        {
          expansions: ["c:hub"],
          openGroups: [
            groupNodeId("c:hub", "pkg:models/gone"),
            groupNodeId("c:other", "pkg:models/x"),
          ],
        },
        fetchGrouped,
      );
      expect(store.get().groups["c:hub"]?.open).toEqual({});
      expect(ids(store.get())).toEqual(["hub"]);
    });
  });

  it("replays a saved parent expansion even when the start table's render count is zero", async () => {
    // A render sent while the manifest briefly lacked c's parent carries parentCount 0, yet the parent exists.
    const parentsOnlyOf = vi.fn(async (direction: string, id: string) =>
      direction === "parents" && id === "c" ? [TABLES.b] : [],
    );
    const store = storeOf(emptyGraph({ ...TABLES.c, parentCount: 0 }));
    await replayExpansions(store, { expansions: ["p:c"] }, parentsOnlyOf);
    expect(parentsOnlyOf).toHaveBeenCalledWith("parents", "c");
    expect(store.get().expansions).toEqual(["p:c"]);
    expect(ids(store.get())).toEqual(["b", "c"]);
  });

  it("lists columns only for drawn tables and caches them", async () => {
    const fetchColumns = vi.fn(async (id: string) => [
      { table: id, name: "id" },
    ]);
    const store = storeOf(emptyGraph(TABLES.a));
    await showColumns(store, ["a", "c"], fetchColumns);
    expect(store.get().columnTables).toEqual(["a"]);
    const hidden = hideColumns(store.get(), "a");
    expect(hidden.columnTables).toEqual([]);
    await showColumns(storeOf(hidden), ["a"], fetchColumns);
    expect(fetchColumns).toHaveBeenCalledTimes(1);
  });

  it("draws a known parent-child pair between drawn tables even when a different expansion fetched it", async () => {
    const store = storeOf(emptyGraph(TABLES.b));
    await expandLevels(store, 1, fetchNeighbours);
    await expand(store, "children", "a", fetchNeighbours);
    const { edges } = drawnGraph(store.get());
    expect(edges.map((e) => e.join(">")).sort()).toEqual(["a>b", "b>c", "d>b"]);
  });

  it("drops an in-flight expansion when it is collapsed meanwhile", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    let release: (tables: lineage.LineageTable[]) => void = () => undefined;
    const slow = () =>
      new Promise<lineage.LineageTable[]>((r) => (release = r));
    const pending = expand(store, "children", "a", slow);
    store.update((s) => collapse(s, "children", "a"));
    release([TABLES.b]);
    expect(await pending).toEqual([]);
    expect(ids(store.get())).toEqual(["a"]);
  });

  it("does not start a second fetch for an expansion still loading, and a collapse clears it", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    let release: (tables: lineage.LineageTable[]) => void = () => undefined;
    const slow = vi.fn(
      () => new Promise<lineage.LineageTable[]>((r) => (release = r)),
    );
    const first = expand(store, "children", "a", slow);
    expect(store.get().pending).toEqual(["c:a"]);
    expect(await expand(store, "children", "a", slow)).toEqual([]);
    expect(slow).toHaveBeenCalledTimes(1);

    store.update((s) => collapse(s, "children", "a"));
    expect(store.get().pending).toEqual([]);
    release([TABLES.b]);
    expect(await first).toEqual([]);
    expect(ids(store.get())).toEqual(["a"]);
  });

  it("applies a re-expand made while the first fetch was still out, and drops the first answer", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    const releases: ((tables: lineage.LineageTable[]) => void)[] = [];
    const slow = () =>
      new Promise<lineage.LineageTable[]>((r) => releases.push(r));
    const first = expand(store, "children", "a", slow);
    store.update((s) => collapse(s, "children", "a"));
    const second = expand(store, "children", "a", slow);
    releases[0]?.([TABLES.c]);
    releases[1]?.([TABLES.b]);
    expect(await first).toEqual([]);
    expect(await second).toEqual(["b"]);
    expect(ids(store.get())).toEqual(["a", "b"]);
  });

  it("clears the pending key when the fetch fails", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    await expect(
      expand(store, "children", "a", () => Promise.reject(new Error("down"))),
    ).rejects.toThrow("down");
    expect(store.get().pending).toEqual([]);
  });

  it("draws a diamond's shortcut edge between drawn tables, which a collapse does not keep alive", async () => {
    // d -> b, b -> c, and the shortcut d -> c, drawn through b's expansions only.
    const store = storeOf(emptyGraph(TABLES.b));
    await expandLevels(store, 1, fetchNeighbours);
    expect(drawnGraph(store.get()).edges).not.toContainEqual(["d", "c"]);

    const fetchEdges = vi.fn(async () => [["d", "c"]] as [string, string][]);
    await linkDrawn(store, fetchEdges);
    expect(fetchEdges).toHaveBeenCalledWith(["b", "a", "d", "c"]);
    expect(drawnGraph(store.get()).edges).toContainEqual(["d", "c"]);

    store.update((s) => collapse(s, "children", "b"));
    expect(ids(store.get())).toEqual(["a", "b", "d"]);
    expect(drawnGraph(store.get()).edges).not.toContainEqual(["d", "c"]);
  });

  it("keeps column case in handle IDs", () => {
    expect(columnHandle("in", "OrderID")).toBe("in:OrderID");
  });

  it("traces a column through drawn tables in both directions, hop by hop", async () => {
    const store = storeOf(emptyGraph(TABLES.b));
    await expandLevels(store, 2, fetchNeighbours);
    const edges: lineage.ColumnLineage[] = [
      { source: ["a", "id"], target: ["b", "ID"], type: "direct" },
      { source: ["b", "id"], target: ["c", "id"], type: "direct" },
      { source: ["d", "flag"], target: ["b", "id"], type: "indirect" },
      { source: ["z", "id"], target: ["b", "id"], type: "direct" },
    ];
    const fetchConnected = vi.fn(
      async ({
        targets,
        upstreamExpansion,
      }: lineage.ConnectedColumnsParams) => {
        const wanted = new Set(
          targets.map(([t, c]) => `${t}.${c.toLowerCase()}`),
        );
        return {
          column_lineage: edges.filter((e) => {
            const [t, c] = upstreamExpansion ? e.source : e.target;
            return wanted.has(`${t}.${c.toLowerCase()}`);
          }),
        };
      },
    );
    const touched = await traceColumn(store, ["b", "id"], fetchConnected);
    expect(touched.sort()).toEqual(["a", "b", "c", "d"]);
    expect(store.get().columnEdges).toHaveLength(3);
    expect(store.get().selectedColumn).toEqual(["b", "id"]);
    expect(store.get().selectedTable).toBe("b");
    expect(
      lineageData(store.get(), { direct: true, indirect: false }).columnEdges,
    ).toHaveLength(2);
  });

  it("drops a trace answer once another column is selected", async () => {
    const store = storeOf(emptyGraph(TABLES.a));
    const touched = await traceColumn(store, ["a", "id"], async () => {
      store.update((s) => ({ ...s, selectedColumn: ["a", "other"] }));
      return {
        column_lineage: [
          { source: ["a", "id"], target: ["a", "x"], type: "direct" },
        ],
      };
    });
    expect(touched).toEqual([]);
    expect(store.get().columnEdges).toEqual([]);
  });
});

describe("folder grouping", () => {
  // A finance-shaped hub: 350 children over 15 folders.
  const HUB_CHILDREN = Array.from({ length: 350 }, (_, i) => ({
    ...table(`t${i}`),
    path: `models/finance/f${i % 15}/t${i}.sql`,
    rootPackage: true,
  }));
  const hub = (cap: number, groupBy: "none" | "folder" = "folder") =>
    addNeighbours(
      emptyGraph(table("hub", 350), cap, groupBy),
      "children",
      "hub",
      HUB_CHILDREN,
    );
  const bucketsOf = (state: GraphState) => state.groups["c:hub"];

  it("buckets a hub's children by folder once they outnumber the cap, and keeps them all", () => {
    const state = hub(20);
    expect(bucketsOf(state)?.buckets).toHaveLength(15);
    expect(bucketsOf(state)?.loose).toEqual([]);
    expect(state.neighbours["c:hub"]).toHaveLength(350);
    expect(state.shown).toEqual({});
    expect(ids(state)).toEqual(["hub"]);
  });

  it("draws the members of an open bucket only", () => {
    const state = hub(20);
    const group = bucketsOf(state);
    expect(group).toBeDefined();
    if (!group) {
      return;
    }
    const opened: GraphState = {
      ...state,
      groups: {
        ...state.groups,
        "c:hub": { ...group, open: { "models/finance/f3": 24 } },
      },
    };
    expect(ids(opened)).toHaveLength(25);
    expect(ids(opened)).toContain("t3");
    expect(ids(opened)).not.toContain("t4");
  });

  it("falls back to the capped path when the buckets would not fit the cap", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => ({
      ...table(id),
      path: `models/${id}/${id}.sql`,
      rootPackage: true,
    }));
    const state = addNeighbours(
      emptyGraph(table("hub", 5), 2, "folder"),
      "children",
      "hub",
      five,
    );
    expect(state.groups).toEqual({});
    expect(state.shown).toEqual({ "c:hub": 2 });
  });

  it("never buckets when groupBy is none", () => {
    const state = hub(20, "none");
    expect(state.groups).toEqual({});
    expect(state.shown).toEqual({ "c:hub": 20 });
  });

  it("a collapse drops the buckets", () => {
    expect(collapse(hub(20), "children", "hub").groups).toEqual({});
  });

  it("asks for the links of closed members as well as the drawn tables", async () => {
    const store = storeOf(hub(20));
    const fetchEdges = vi.fn(
      async (_tables: readonly string[]) => [] as [string, string][],
    );
    await linkDrawn(store, fetchEdges);
    const asked = fetchEdges.mock.calls[0]?.[0] ?? [];
    expect(asked).toHaveLength(351);
    expect(asked[0]).toBe("hub");
  });
});

describe("expander and column clicks", () => {
  const open = (state: GraphState, patch: Partial<GraphState>): GraphState => ({
    ...state,
    ...patch,
  });

  describe("expansionClick", () => {
    it("expands a closed expander", () => {
      const state = emptyGraph(TABLES.b);
      expect(expansionClick(state, "children", "b")).toBe("expand");
      expect(expansionClick(state, "parents", "b")).toBe("expand");
    });

    it("collapses an open expander", () => {
      const state = open(emptyGraph(TABLES.b), { expansions: ["c:b"] });
      expect(expansionClick(state, "children", "b")).toBe("collapse");
    });

    it("collapses a pending expander, so a click cancels the fetch", () => {
      const state = open(emptyGraph(TABLES.b), { pending: ["p:b"] });
      expect(expansionClick(state, "parents", "b")).toBe("collapse");
    });

    it("judges each direction and table on its own", () => {
      const state = open(emptyGraph(TABLES.b), {
        expansions: ["c:b"],
        pending: ["p:a"],
      });
      expect(expansionClick(state, "parents", "b")).toBe("expand");
      expect(expansionClick(state, "children", "a")).toBe("expand");
      expect(expansionClick(state, "parents", "a")).toBe("collapse");
    });
  });

  describe("columnClick", () => {
    const selected = (
      column: [table: string, column: string] | undefined,
    ): GraphState => open(emptyGraph(TABLES.b), { selectedColumn: column });

    it("traces when no column is selected", () => {
      expect(columnClick(selected(undefined), ["b", "id"])).toBe("trace");
    });

    it("clears a click on the selected column", () => {
      expect(columnClick(selected(["b", "id"]), ["b", "id"])).toBe("clear");
    });

    it("clears a click that differs from the selected column only in case", () => {
      expect(columnClick(selected(["b", "ID"]), ["b", "id"])).toBe("clear");
      expect(columnClick(selected(["b", "id"]), ["b", "Id"])).toBe("clear");
    });

    it("traces a different column on the same table", () => {
      expect(columnClick(selected(["b", "id"]), ["b", "name"])).toBe("trace");
    });

    it("traces the same column name on a different table", () => {
      expect(columnClick(selected(["b", "id"]), ["c", "id"])).toBe("trace");
    });
  });
});
