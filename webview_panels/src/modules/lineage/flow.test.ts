import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { GroupChip } from "./expansionGroups";
import { collapsedGroups } from "./expansionGroups";
import type { FlowInput } from "./flow";
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
    const { nodes } = toFlow({
      ...input([["hub", "g:1"]]),
      layout: "leftToRight",
    });
    const hub = nodes.find((n) => n.id === "hub");
    const group = nodes.find((n) => n.id === "g:1");
    expect(group?.type).toBe("group");
    expect(group?.data).toEqual({ label: "finance", count: 3, layered: false });
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
    expect(nodes.filter((n) => n.type !== "band").map((n) => n.id)).toEqual([
      "hub",
      "g:1",
    ]);
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
    const base = tableHeight(undefined, 0, true);
    const height = (count: number) =>
      hubNode(Array.from({ length: count }, (_, i) => chip(i)))?.initialHeight;
    expect(height(0)).toBe(base);
    expect(height(1)).toBe(base + geometry.chipRowHeight);
    expect(height(2)).toBe(base + geometry.chipRowHeight);
    expect(height(3)).toBe(base + 2 * geometry.chipRowHeight);
    expect(height(4)).toBe(base + 2 * geometry.chipRowHeight);
  });

  it("reserves the relation line only on the start card", () => {
    const hub = toFlow({
      data: {
        start: "other",
        tables: [table("hub")],
        edges: [],
        columnEdges: [],
      },
      columns: {},
      columnTables: [],
      expansions: [],
      errors: {},
      refs: [],
    }).nodes.find((n) => n.id === "hub");
    expect(hub?.initialHeight).toBe(tableHeight(undefined, 0));
    expect(tableHeight(undefined, 0, true)).toBe(
      tableHeight(undefined, 0) + geometry.relationHeight,
    );
  });

  it("spaces a selected card by the height it is drawn at, relation line included", () => {
    for (const selectedTable of ["a", "b"]) {
      const { nodes } = toFlow({
        layout: "leftToRight",
        data: {
          start: "hub",
          tables: [table("hub"), table("a"), table("b")],
          edges: [
            ["hub", "a"],
            ["hub", "b"],
          ],
          columnEdges: [],
        },
        columns: {},
        columnTables: [],
        expansions: [],
        errors: {},
        refs: [],
        selectedTable,
      });
      const [upper, lower] = nodes
        .filter((n) => n.id === "a" || n.id === "b")
        .sort((x, y) => x.position.y - y.position.y);
      expect(lower?.position.y ?? 0).toBe(
        (upper?.position.y ?? 0) +
          (upper?.initialHeight ?? 0) +
          geometry.nodeGap,
      );
    }
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

describe("toFlow layered layout", () => {
  const tables: lineage.LineageTable[] = [
    { ...table("src"), nodeType: "source" },
    { ...table("stg"), layer: "staging" },
    { ...table("mart"), layer: "marts" },
  ];
  const layeredInput = (layout?: lineage.LineageLayout): FlowInput => ({
    layout,
    data: {
      start: "stg",
      tables,
      edges: [
        ["src", "stg"],
        ["stg", "mart"],
      ],
      columnEdges: [],
    },
    columns: {},
    columnTables: [],
    expansions: [],
    errors: {},
    refs: [],
  });
  const at = (nodes: ReturnType<typeof toFlow>["nodes"], id: string) =>
    nodes.find((n) => n.id === id);

  it("is the default: parents above their children, and cards keep the top and bottom bubbles", () => {
    const { nodes } = toFlow(layeredInput());
    const y = (id: string) => at(nodes, id)?.position.y ?? NaN;
    expect(y("src")).toBeLessThan(y("stg"));
    expect(y("stg")).toBeLessThan(y("mart"));
    expect(at(nodes, "stg")?.data).toMatchObject({ layered: true });
  });

  it("draws one band per layer behind the cards, and bands take no selection or drag", () => {
    const { nodes } = toFlow(layeredInput());
    const bands = nodes.filter((n) => n.type === "band");
    expect(bands.map((b) => b.data.tag).sort()).toEqual([
      "marts",
      "source",
      "staging",
    ]);
    expect(nodes.slice(0, bands.length).every((n) => n.type === "band")).toBe(
      true,
    );
    expect(
      bands.every((b) => b.selectable === false && b.draggable === false),
    ).toBe(true);
    // React Flow sets pointer events on any node with a click handler; a band must not take the click.
    expect(bands.every((b) => b.style?.pointerEvents === "none")).toBe(true);
    expect(bands[0]?.data.colour).toMatch(/^var\(--vscode-charts-/);
  });

  it("colours each arrowhead with its edge's stroke, and draws none on relationships", () => {
    const base = layeredInput();
    const { edges } = toFlow({
      ...base,
      data: {
        ...base.data,
        columnEdges: [
          { source: ["src", "id"], target: ["stg", "id"], type: "direct" },
        ],
      },
      selectedTable: "stg",
      refs: [
        {
          id: "ref1",
          from: { table: "mart", columns: ["id"] },
          to: { table: "src", columns: ["id"] },
          cardinality: "many-to-one",
          source: "test",
        },
      ],
    });
    const colour = (id: string) =>
      (edges.find((e) => e.id === id)?.markerEnd as { color?: string })?.color;
    expect(colour("t:src->stg")).toBe("var(--lineage-selected-stroke)");
    expect(colour("t:stg->mart")).toBe("var(--lineage-selected-stroke)");
    expect(colour("c:src.id->stg.id")).toBe("var(--lineage-column-stroke)");
    expect(edges.find((e) => e.id === "r:ref1")).toBeDefined();
    expect(edges.find((e) => e.id === "r:ref1")?.markerEnd).toBeUndefined();
  });

  it("colours an unselected table edge's arrowhead with the table edge stroke", () => {
    const { edges } = toFlow(layeredInput());
    const edge = edges.find((e) => e.id === "t:src->stg");
    expect(edge?.markerEnd).toEqual({
      type: "arrowclosed",
      color: "var(--xy-edge-stroke)",
    });
  });

  it("places a group node in the band of its dominant layer, not its anchor's", () => {
    const { nodes } = toFlow({
      ...layeredInput(),
      groups: [
        {
          id: "g:1",
          label: "mixed",
          count: 3,
          edge: ["stg", "g:1"],
          layerTags: ["marts", "marts", "staging"],
        },
      ],
      groupEdges: [["stg", "g:1"]],
    });
    const group = at(nodes, "g:1");
    const band = (tag: string) =>
      nodes.find((n) => n.type === "band" && n.data.tag === tag);
    const within = (tag: string) => {
      const b = band(tag);
      return (
        b !== undefined &&
        group!.position.y >= b.position.y &&
        group!.position.y < b.position.y + (b.height ?? 0)
      );
    };
    expect(within("marts")).toBe(true);
    expect(within("staging")).toBe(false);
  });

  it("draws every edge along its routed path, with an arrowhead", () => {
    const { edges } = toFlow(layeredInput());
    expect(edges.map((e) => e.id).sort()).toEqual([
      "t:src->stg",
      "t:stg->mart",
    ]);
    for (const edge of edges) {
      expect(edge.type).toBe("routed");
      expect(String(edge.data?.d)).toMatch(/^M\d/);
      expect(edge.markerEnd).toBeDefined();
    }
  });

  it("with leftToRight keeps dagre's placement, bezier edges and no bands", () => {
    const { nodes, edges } = toFlow(layeredInput("leftToRight"));
    expect(nodes.some((n) => n.type === "band")).toBe(false);
    expect(at(nodes, "stg")?.data).toMatchObject({ layered: false });
    expect(edges.every((e) => e.type === undefined)).toBe(true);
    expect(at(nodes, "mart")!.position.x).toBeGreaterThan(
      at(nodes, "stg")!.position.x,
    );
  });
});
