import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it, vi } from "vitest";
import {
  collapse,
  drawnGraph,
  emptyGraph,
  expand,
  expandLevels,
  GraphState,
  GraphStore,
  hideColumns,
  lineageData,
  parseExpansion,
  replayExpansions,
  showColumns,
  traceColumn,
} from "./graph";
import { columnHandle, layout, tableHeight } from "./layout";

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
      ["c:b", "c:a", "c:b", "x:a"],
      fetchNeighbours,
    );
    expect(store.get().expansions).toEqual(["c:a", "c:b"]);
    expect(ids(store.get())).toEqual(["a", "b", "c"]);
    expect(parseExpansion("x:a")).toBeUndefined();
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

  it("lays parents left of children with dagre", () => {
    const positions = layout(
      [TABLES.a, TABLES.b, TABLES.c],
      [
        ["a", "b"],
        ["b", "c"],
      ],
      () => tableHeight([1, 2]),
    );
    const x = (id: string) => positions.get(id)!.x;
    expect(x("a")).toBeLessThan(x("b"));
    expect(x("b")).toBeLessThan(x("c"));
  });
});
