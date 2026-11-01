import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { edgeGroupsOf, withoutEdgeGroups } from "./edgeGroups";
import type { LayoutInput } from "./engine/layoutRequest";
import { layoutRequest } from "./engine/layoutRequest";

const table = (id: string, nodeType = "model"): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType,
  parentCount: 0,
  childCount: 0,
  tests: [],
});

const columnEdge = (
  source: [string, string],
  target: [string, string],
): lineage.ColumnLineage => ({ source, target, type: "direct" });

const ref = (id: string, from: string, to: string): lineage.LineageRef => ({
  id,
  from: { table: from, columns: ["id"] },
  to: { table: to, columns: ["id"] },
  cardinality: "many_to_one",
  source: "contract",
});

/**
 * `src` is a source feeding `a`; `a` feeds `b` and `c`, and `b` feeds `c`. Every kind of edge is present: a grouped
 * edge from `g` to `a`, a column edge from `a` to `b`, and a relationship from `c` to `b`.
 */
const input = (): LayoutInput => ({
  data: {
    start: "a",
    tables: [
      table("src", "source"),
      table("a"),
      table("b"),
      table("c"),
      table("g"),
    ],
    edges: [
      ["src", "a"],
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ],
    columnEdges: [columnEdge(["a", "x"], ["b", "x"])],
  },
  columns: {},
  columnTables: [],
  groupEdges: [["g", "a"]],
  refs: [ref("r1", "c", "b")],
});

const tableEdgesOf = (layout: LayoutInput) => layout.data.edges;

describe("edgeGroupsOf", () => {
  it("lists every edge kind the graph draws, in the Scope control's order", () => {
    expect(edgeGroupsOf(input())).toEqual([
      "model",
      "source",
      "grouped",
      "column",
      "relationship",
    ]);
  });

  it("lists no group for a kind the graph does not draw", () => {
    const plain: LayoutInput = {
      ...input(),
      groupEdges: undefined,
      refs: [],
      data: { ...input().data, columnEdges: [] },
    };
    expect(edgeGroupsOf(plain)).toEqual(["model", "source"]);
  });
});

describe("withoutEdgeGroups", () => {
  it("removes exactly the model edges when model dependencies are off", () => {
    const layout = withoutEdgeGroups(input(), ["model"]);
    expect(tableEdgesOf(layout)).toEqual([["src", "a"]]);
    expect(layout.groupEdges).toEqual([["g", "a"]]);
    expect(layout.data.columnEdges).toEqual(input().data.columnEdges);
    expect(layout.refs).toEqual(input().refs);
  });

  it("removes exactly the source edges when source dependencies are off", () => {
    const layout = withoutEdgeGroups(input(), ["source"]);
    expect(tableEdgesOf(layout)).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("removes the grouped, column and relationship edges by their own switches", () => {
    const layout = withoutEdgeGroups(input(), [
      "grouped",
      "column",
      "relationship",
    ]);
    expect(layout.groupEdges).toEqual([]);
    expect(layout.data.columnEdges).toEqual([]);
    expect(layout.refs).toEqual([]);
    expect(tableEdgesOf(layout)).toEqual(tableEdgesOf(input()));
  });

  it("removes nothing when no group is off, so the input is the same object", () => {
    const layout = input();
    expect(withoutEdgeGroups(layout, [])).toBe(layout);
  });

  it("restores the same layout input when the group is switched back on", () => {
    const base = input();
    const off = withoutEdgeGroups(base, ["model"]);
    expect(off.data.edges).not.toEqual(base.data.edges);
    expect(withoutEdgeGroups(base, [])).toBe(base);
    expect(withoutEdgeGroups(base, [])).toEqual(input());
  });

  it("leaves the routed edges of the layout request to the edges that remain", () => {
    const requestOf = (layout: LayoutInput) =>
      layoutRequest(
        layout,
        () => undefined,
        () => 40,
      );
    const all = requestOf(input()).edges.map((edge) => edge.id);
    const without = requestOf(withoutEdgeGroups(input(), ["model"])).edges.map(
      (edge) => edge.id,
    );
    expect(all).toHaveLength(7);
    expect(without).toEqual(
      all.filter((id) => !["t:a->b", "t:a->c", "t:b->c"].includes(id)),
    );
  });
});
