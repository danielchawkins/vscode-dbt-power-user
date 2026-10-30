import type { lineage } from "@fusion-power-user/webview-contract";
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { FlowDecoration, LayoutInput } from "./engine/layoutRequest";
import type { GroupChip } from "./expansionGroups";
import { collapsedGroups } from "./expansionGroups";
import { drawnEdges, toFlow } from "./flow";
import { addNeighbours, emptyGraph } from "./graph";
import { combinedEdges } from "./groupEdges";
import { groupNodeId } from "./grouping";
import { geometry, tableHeight } from "./layout";
import type { RoutedRelationshipData } from "./relationshipRoute";
import { lineageData } from "./visibility";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 0,
  parentCount: 0,
  tests: [],
});

/**
 * A test input: the layout input and the decoration in one object. `pinned` defaults to the start and the selected
 * table, which the panel pins.
 */
type TestInput = Omit<LayoutInput, "pinned"> &
  FlowDecoration & { pinned?: readonly string[] };

/** `toFlow` for a test input, split into its layout input and its decoration. */
const toFlowOf = (flat: TestInput) => {
  const pinned =
    flat.pinned ??
    [flat.data.start, flat.selectedTable].filter(
      (name): name is string => name !== undefined,
    );
  return toFlow({ ...flat, pinned }, flat);
};

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
    const { nodes } = toFlowOf(input([["hub", "g:1"]]));
    const hub = nodes.find((n) => n.id === "hub");
    const group = nodes.find((n) => n.id === "g:1");
    expect(group?.type).toBe("folderGroup");
    expect(group?.data).toEqual({ label: "finance", count: 3 });
    expect(group?.initialHeight).toBe(geometry.groupHeight);
    expect(group?.initialWidth).toBe(geometry.tableWidth);
    expect(Number.isFinite(group?.position.x)).toBe(true);
    expect(Number.isFinite(group?.position.y)).toBe(true);
    // Children sit below their parent in the layered layout.
    expect(group!.position.y).toBeGreaterThan(hub!.position.y);
  });

  it("gives a group node the card's width, not React Flow's built-in 150px group type", () => {
    const { nodes } = toFlowOf(input([["hub", "g:1"]]));
    const group = nodes.find((n) => n.id === "g:1");
    expect(group?.type).not.toBe("group");
    // React Flow measures a node from its wrapper's width, which is the size given before measurement.
    expect(group?.initialWidth).toBe(geometry.tableWidth);
  });

  it("draws the given group edges to the group nodes", () => {
    const { edges } = toFlowOf(input([["hub", "g:1"]]));
    expect(edges).toContainEqual(
      expect.objectContaining({ source: "hub", target: "g:1" }),
    );
  });

  it("draws no group edges when none are given", () => {
    const { nodes, edges } = toFlowOf(input([]));
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
    const { nodes, edges } = toFlowOf({
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
    expect(
      nodes.filter((n) => n.type === "folderGroup").map((n) => n.id),
    ).toEqual([groupA, groupB]);
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
    toFlowOf({
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

  it("grows the card by one chip row per two chips, up to the two-row cap", () => {
    const base = tableHeight(undefined, 0, true);
    const height = (count: number) =>
      hubNode(Array.from({ length: count }, (_, i) => chip(i)))?.initialHeight;
    expect(height(0)).toBe(base);
    expect(height(1)).toBe(base + geometry.chipRowHeight);
    expect(height(2)).toBe(base + geometry.chipRowHeight);
    expect(height(3)).toBe(base + 2 * geometry.chipRowHeight);
    expect(height(4)).toBe(base + 2 * geometry.chipRowHeight);
    expect(height(5)).toBe(base + 2 * geometry.chipRowHeight);
    expect(height(8)).toBe(base + 2 * geometry.chipRowHeight);
  });

  it("reserves the relation line and actions row only on the start card", () => {
    const hub = toFlowOf({
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
      tableHeight(undefined, 0) +
        geometry.relationHeight +
        geometry.actionsHeight,
    );
  });

  it("gives the table node the chips it is passed", () => {
    expect(hubNode([chip(1)])?.data).toMatchObject({ chips: [chip(1)] });
  });
});

describe("toFlow title mode", () => {
  const titleOf = (title?: "alias" | "name") =>
    toFlowOf({ ...input([]), groups: [], title }).nodes.find(
      (n) => n.id === "hub",
    )?.data;

  it("passes the title mode to the table node, by alias when absent", () => {
    expect(titleOf("name")).toMatchObject({ title: "name" });
    expect(titleOf("alias")).toMatchObject({ title: "alias" });
    expect(titleOf()).toMatchObject({ title: "alias" });
  });
});

describe("toFlow layout", () => {
  const tables: lineage.LineageTable[] = [
    { ...table("src"), nodeType: "source" },
    { ...table("stg"), layer: "staging" },
    { ...table("mart"), layer: "marts" },
  ];
  const layeredInput = (): TestInput => ({
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

  it("places parents above their children", () => {
    const { nodes } = toFlowOf(layeredInput());
    const y = (id: string) => at(nodes, id)?.position.y ?? NaN;
    expect(y("src")).toBeLessThan(y("stg"));
    expect(y("stg")).toBeLessThan(y("mart"));
  });

  it("draws one band per layer behind the cards, and bands take no selection or drag", () => {
    const { nodes } = toFlowOf(layeredInput());
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
    const { edges } = toFlowOf({
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
    const { edges } = toFlowOf(layeredInput());
    const edge = edges.find((e) => e.id === "t:src->stg");
    expect(edge?.markerEnd).toEqual({
      type: "arrowclosed",
      color: "var(--xy-edge-stroke)",
    });
  });

  it("places a group node in the band of its dominant layer, not its anchor's", () => {
    const { nodes } = toFlowOf({
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
    const { edges } = toFlowOf(layeredInput());
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

  it("keeps a routed relationship's type, ref and card ends, with no arrowhead", () => {
    const base = layeredInput();
    const { edges } = toFlowOf({
      ...base,
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
    const rel = edges.find((e) => e.id === "r:ref1");
    expect(rel?.type).toBe("relationship");
    expect(rel?.markerEnd).toBeUndefined();
    const data = rel?.data as {
      ref: lineage.LineageRef;
      routed: RoutedRelationshipData;
    };
    expect(data.ref.id).toBe("ref1");
    expect(data.routed.d).toMatch(/^M-?\d/);
    // `src` sits above `mart`, so the referenced end leaves `src`'s bottom and the declaring end enters `mart`'s top.
    expect(data.routed.source.position).toBe(Position.Bottom);
    expect(data.routed.target.position).toBe(Position.Top);
  });

  it(
    "ends a same-row relationship on its referenced card and its declaring card " +
      "when the referenced card is selected and taller",
    () => {
      const base = layeredInput();
      const { nodes, edges } = toFlowOf({
        ...base,
        data: {
          ...base.data,
          start: "stg",
          tables: [
            { ...table("stg"), layer: "staging" },
            { ...table("ref"), layer: "marts" },
            { ...table("decl"), layer: "marts" },
          ],
          edges: [],
        },
        selectedTable: "ref",
        refs: [
          {
            id: "ref1",
            from: { table: "decl", columns: ["id"] },
            to: { table: "ref", columns: ["id"] },
            cardinality: "many-to-one",
            source: "test",
          },
        ],
      });
      const box = (id: string) => {
        const node = nodes.find((n) => n.id === id);
        if (node?.type !== "table") {
          throw new Error(`${id} is not drawn as a table card`);
        }
        return {
          left: node.position.x,
          right: node.position.x + geometry.tableWidth,
          top: node.position.y,
          bottom: node.position.y + (node.initialHeight ?? 0),
        };
      };
      const ref = box("ref");
      const decl = box("decl");
      // The cards share a row. The selected card is taller and centred on that row, so the two centres are level.
      const centre = (b: { top: number; bottom: number }) =>
        (b.top + b.bottom) / 2;
      expect(ref.bottom - ref.top).toBeGreaterThan(decl.bottom - decl.top);
      expect(centre(ref)).toBe(centre(decl));
      const rel = edges.find((e) => e.id === "r:ref1");
      const { routed } = rel!.data as { routed: RoutedRelationshipData };
      // The source is the referenced card's bar and the target the declaring card's crow's foot: each ends on one of
      // its own card's edges, not on the other card's.
      expect([ref.top, ref.bottom]).toContain(routed.source.y);
      expect([decl.top, decl.bottom]).toContain(routed.target.y);
      expect(routed.source.x).toBeGreaterThanOrEqual(ref.left);
      expect(routed.source.x).toBeLessThanOrEqual(ref.right);
      expect(routed.target.x).toBeGreaterThanOrEqual(decl.left);
      expect(routed.target.x).toBeLessThanOrEqual(decl.right);
      expect(routed.source.position).toBe(
        routed.source.y === ref.top ? Position.Top : Position.Bottom,
      );
      expect(routed.target.position).toBe(
        routed.target.y === decl.top ? Position.Top : Position.Bottom,
      );
    },
  );
});

describe("toFlow connections", () => {
  const ref: lineage.LineageRef = {
    id: "ref1",
    from: { table: "child", columns: ["hub_id"] },
    to: { table: "hub", columns: ["id"] },
    cardinality: "many-to-one",
    source: "meta",
  };
  const mixed = (connections?: lineage.Connections) => ({
    data: {
      start: "hub",
      tables: [table("hub"), table("child")],
      edges: [["hub", "child"]] as [string, string][],
      columnEdges: [
        {
          source: ["hub", "id"] as [string, string],
          target: ["child", "hub_id"] as [string, string],
          type: "direct" as const,
        },
      ],
    },
    columns: {},
    columnTables: [],
    expansions: [],
    errors: {},
    // The caller filters refs by connections; under dbt none reach toFlow.
    refs: connections === "dbt" || connections === undefined ? [] : [ref],
    groups: [
      {
        id: "g:1",
        label: "finance",
        count: 1,
        edge: ["hub", "g:1"] as [string, string],
      },
    ],
    groupEdges: [["hub", "g:1"]] as [string, string][],
    connections,
  });
  const edgeIds = (connections?: lineage.Connections) =>
    toFlowOf(mixed(connections))
      .edges.map((e) => e.id)
      .sort();

  it("draws only dbt table, group and column edges under dbt", () => {
    expect(edgeIds("dbt")).toEqual([
      "c:hub.id->child.hub_id",
      "g:hub->g:1",
      "t:hub->child",
    ]);
  });

  it("treats an absent connections as dbt", () => {
    expect(edgeIds(undefined)).toEqual(edgeIds("dbt"));
  });

  it("gives each relationship edge type relationship, from the referenced side", () => {
    for (const connections of ["declared", "both"] as const) {
      const rel = toFlowOf(mixed(connections)).edges.find(
        (e) => e.id === "r:ref1",
      );
      expect(rel).toMatchObject({
        type: "relationship",
        source: "hub",
        target: "child",
        data: { ref },
      });
    }
  });

  it("under declared, draws only relationship and column edges, with the referenced table above", () => {
    const { nodes, edges } = toFlowOf(mixed("declared"));
    expect(edges.map((e) => e.id).sort()).toEqual([
      "c:hub.id->child.hub_id",
      "r:ref1",
    ]);
    expect(edges.filter((e) => e.type === "routed").length).toBe(1);
    const y = (id: string) => nodes.find((n) => n.id === id)?.position.y ?? NaN;
    expect(y("hub")).toBeLessThan(y("child"));
  });

  it("under both, routes every kind of edge", () => {
    const { edges } = toFlowOf(mixed("both"));
    expect(edges.map((e) => e.id).sort()).toEqual([
      "c:hub.id->child.hub_id",
      "g:hub->g:1",
      "r:ref1",
      "t:hub->child",
    ]);
    expect(edges.find((e) => e.id === "r:ref1")?.type).toBe("relationship");
    expect(edges.filter((e) => e.type === "routed").length).toBe(3);
    expect(edges.find((e) => e.id === "r:ref1")?.markerEnd).toBeUndefined();
  });
});

describe("drawnEdges", () => {
  const { edges } = toFlowOf({
    data: {
      start: "hub",
      tables: [table("hub"), table("x")],
      edges: [["hub", "x"]],
      columnEdges: [
        {
          source: ["hub", "id"],
          target: ["x", "id"],
          type: "direct",
        },
      ],
    },
    columns: {},
    columnTables: [],
    expansions: [],
    errors: {},
    refs: [
      {
        id: "r1",
        from: { table: "hub", columns: ["id"] },
        to: { table: "x", columns: ["id"] },
        cardinality: "1:N",
        source: "contract",
      },
    ],
    groups: [
      {
        id: "g:1",
        label: "finance",
        count: 3,
        edge: ["hub", "g:1"],
      },
    ],
    groupEdges: [["hub", "g:1"]],
  });

  it("leaves out column edges below the threshold and keeps the other edges as the same objects, in order", () => {
    const [tableEdge, groupEdge, columnEdge, refEdge] = edges;
    expect(edges.map((e) => e.id.split(":")[0])).toEqual(["t", "g", "c", "r"]);
    expect(columnEdge?.className).toContain("lineage-column-edge");

    const kept = drawnEdges(edges, true);
    expect(kept.some((e) => e.className?.includes("lineage-column-edge"))).toBe(
      false,
    );
    expect(kept).toHaveLength(3);
    expect(kept[0]).toBe(tableEdge);
    expect(kept[1]).toBe(groupEdge);
    expect(kept[2]).toBe(refEdge);
  });

  it("returns the edges themselves when they are not zoomed out", () => {
    expect(drawnEdges(edges, false)).toBe(edges);
  });
});
