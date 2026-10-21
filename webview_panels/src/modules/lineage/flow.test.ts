import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { GroupChip } from "./expansionGroups";
import { collapsedGroups } from "./expansionGroups";
import { toFlow } from "./flow";
import { addNeighbours, emptyGraph, lineageData } from "./graph";
import { combinedEdges } from "./groupEdges";
import { groupNodeId } from "./grouping";
import { geometry, tableHeight } from "./layout";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 0,
  parentCount: 0,
  tests: [],
});

const input = (groupEdges: [string, string][]) => ({
  data: {
    start: "hub",
    tables: [table("hub")],
    edges: [] as [string, string][],
    columnEdges: [],
  },
  columns: {},
  columnTables: [],
  expansions: ["c:hub"],
  errors: {},
  refs: [],
  groups: [
    {
      id: "g:1",
      label: "finance",
      count: 3,
      edge: ["hub", "g:1"] as [string, string],
    },
  ],
  groupEdges,
});

describe("toFlow with groups", () => {
  it("lays group nodes out with the tables, and gives them the group size", () => {
    const { nodes } = toFlow(input([["hub", "g:1"]]));
    const hub = nodes.find((n) => n.id === "hub");
    const group = nodes.find((n) => n.id === "g:1");
    expect(group?.type).toBe("group");
    expect(group?.data).toEqual({ label: "finance", count: 3 });
    expect(group?.initialHeight).toBe(geometry.groupHeight);
    expect(group?.initialWidth).toBe(geometry.tableWidth);
    expect(Number.isFinite(group?.position.x)).toBe(true);
    expect(Number.isFinite(group?.position.y)).toBe(true);
    // Children sit to the right of their parent in the left-to-right layout.
    expect(group!.position.x).toBeGreaterThan(hub!.position.x);
  });

  it("draws the given group edges to the group nodes", () => {
    const { edges } = toFlow(input([["hub", "g:1"]]));
    expect(edges).toContainEqual(
      expect.objectContaining({ source: "hub", target: "g:1" }),
    );
  });

  it("draws no group edges when none are given", () => {
    const { nodes, edges } = toFlow(input([]));
    expect(nodes.map((n) => n.id)).toEqual(["hub", "g:1"]);
    expect(edges.some((e) => e.target === "g:1")).toBe(false);
  });
});

describe("toFlow with combined edges from a real state", () => {
  it("draws the combined edges to the group nodes they join", () => {
    const child = (folder: string, id: string) => ({
      ...table(id),
      path: `${folder}/${id}.sql`,
      rootPackage: true,
    });
    let state = addNeighbours(
      emptyGraph(table("hub"), 3, "folder"),
      "children",
      "hub",
      [
        child("models/a", "a1"),
        child("models/a", "a2"),
        child("models/b", "b1"),
        child("models/b", "b2"),
        child("models/c", "c1"),
      ],
    );
    state = { ...state, links: { "a1\u0000b1": ["a1", "b1"] } };
    const groups = collapsedGroups(state);
    const groupEdges = combinedEdges(state, groups);
    const { nodes, edges } = toFlow({
      data: lineageData(state, { direct: true, indirect: true }),
      columns: {},
      columnTables: [],
      expansions: state.expansions,
      groups,
      groupEdges,
      errors: {},
      refs: [],
    });
    const groupA = groupNodeId("c:hub", "models/a");
    const groupB = groupNodeId("c:hub", "models/b");
    expect(nodes.filter((n) => n.type === "group").map((n) => n.id)).toEqual([
      groupA,
      groupB,
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "hub", target: groupA }),
        expect.objectContaining({ source: "hub", target: groupB }),
        expect.objectContaining({ source: groupA, target: groupB }),
      ]),
    );
  });
});

describe("toFlow with group chips", () => {
  const chip = (n: number): GroupChip => ({
    id: groupNodeId("c:hub", `models/m${n}`),
    table: "hub",
    label: `m${n}`,
    drawn: 1,
    total: 2,
  });
  const hubNode = (chips: GroupChip[]) =>
    toFlow({
      data: {
        start: "hub",
        tables: [table("hub")],
        edges: [],
        columnEdges: [],
      },
      columns: {},
      columnTables: [],
      expansions: ["c:hub"],
      errors: {},
      refs: [],
      chips,
    }).nodes.find((n) => n.id === "hub");

  it("grows the card by one chip row for every two chips", () => {
    const base = tableHeight(undefined, 0);
    const height = (count: number) =>
      hubNode(Array.from({ length: count }, (_, i) => chip(i)))?.initialHeight;
    expect(height(0)).toBe(base);
    expect(height(1)).toBe(base + geometry.chipRowHeight);
    expect(height(2)).toBe(base + geometry.chipRowHeight);
    expect(height(3)).toBe(base + 2 * geometry.chipRowHeight);
    expect(height(4)).toBe(base + 2 * geometry.chipRowHeight);
  });

  it("gives the table node the chips it is passed", () => {
    expect(hubNode([chip(1)])?.data).toMatchObject({ chips: [chip(1)] });
  });
});

describe("toFlow title mode", () => {
  const titleOf = (title?: "alias" | "name") =>
    toFlow({ ...input([]), groups: [], title }).nodes.find(
      (n) => n.id === "hub",
    )?.data;

  it("passes the title mode to the table node, by alias when absent", () => {
    expect(titleOf("name")).toMatchObject({ title: "name" });
    expect(titleOf("alias")).toMatchObject({ title: "alias" });
    expect(titleOf()).toMatchObject({ title: "alias" });
  });
});
