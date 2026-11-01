import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { LayoutInput } from "./engine/layoutRequest";
import { hintEdges, withoutTransitiveEdges } from "./transitiveReduction";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  parentCount: 0,
  childCount: 0,
  tests: [],
});

/** A layout input whose table edges are `edges` and whose group edges are `groupEdges`. */
const input = (
  edges: [string, string][],
  groupEdges?: [string, string][],
): LayoutInput => {
  const ids = new Set(edges.flat());
  return {
    data: {
      tables: Array.from(ids, table),
      edges,
      columnEdges: [],
    },
    columns: {},
    columnTables: [],
    groupEdges,
    refs: [],
  };
};

/** Every `from -> to` pair reachable over `edges` by a path of one or more edges, as `from>to` keys. */
const reachable = (edges: [string, string][]): Set<string> => {
  const reach = new Set<string>();
  const nodes = new Set(edges.flat());
  for (const start of nodes) {
    const queue = [start];
    const seen = new Set<string>();
    for (const node of queue) {
      for (const [parent, child] of edges) {
        if (parent === node && !seen.has(child)) {
          seen.add(child);
          queue.push(child);
          reach.add(`${start}>${child}`);
        }
      }
    }
  }
  return reach;
};

const edgesOf = (layout: LayoutInput): [string, string][] => [
  ...layout.data.edges,
  ...(layout.groupEdges ?? []),
];

describe("withoutTransitiveEdges", () => {
  it("drops only the shortcut of a diamond plus a shortcut", () => {
    const layout = input([
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
      ["a", "d"],
    ]);
    const { layout: kept, dropped } = withoutTransitiveEdges(layout, true);
    expect(dropped).toEqual([["a", "d"]]);
    expect(kept.data.edges).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "d"],
      ["c", "d"],
    ]);
  });

  it("keeps every edge of a cycle and terminates", () => {
    const layout = input([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    const { layout: kept, dropped } = withoutTransitiveEdges(layout, true);
    expect(dropped).toEqual([]);
    expect(kept).toBe(layout);
  });

  it("keeps the reachability of the input over the kept edges, cycles included", () => {
    const edges: [string, string][] = [
      ["a", "b"],
      ["b", "a"],
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
      ["a", "d"],
      ["d", "e"],
      ["c", "e"],
      ["e", "c"],
    ];
    const layout = input(edges);
    const { layout: kept, dropped } = withoutTransitiveEdges(layout, true);
    expect(dropped.length).toBeGreaterThan(0);
    expect(reachable(edgesOf(kept))).toEqual(reachable(edges));
  });

  it("restores the identical layout input when switched off", () => {
    const layout = input([
      ["a", "b"],
      ["b", "c"],
      ["a", "c"],
    ]);
    const reduced = withoutTransitiveEdges(layout, true);
    expect(reduced.dropped).toEqual([["a", "c"]]);
    expect(withoutTransitiveEdges(layout, false)).toEqual({
      layout,
      dropped: [],
    });
    expect(withoutTransitiveEdges(layout, false).layout).toBe(layout);
  });

  it("reduces the group edges with the table edges", () => {
    const layout = input(
      [
        ["a", "b"],
        ["b", "c"],
      ],
      [["a", "c"]],
    );
    const { layout: kept, dropped } = withoutTransitiveEdges(layout, true);
    expect(dropped).toEqual([["a", "c"]]);
    expect(kept.groupEdges).toEqual([]);
    expect(kept.data.edges).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("drops nothing when no table edge is drawn", () => {
    const layout = { ...input([["a", "b"]]), connections: "declared" as const };
    expect(withoutTransitiveEdges(layout, true).layout).toBe(layout);
  });
});

describe("hintEdges", () => {
  it("draws a dropped edge as a dashed straight hint between its cards, and only between drawn cards", () => {
    const hints = hintEdges(
      [
        ["a", "d"],
        ["a", "x"],
      ],
      new Set(["a", "d"]),
    );
    expect(hints).toEqual([
      expect.objectContaining({
        id: "h:a->d",
        type: "straight",
        source: "a",
        target: "d",
        className: "lineage-hint-edge",
      }),
    ]);
    expect(hints[0]).not.toHaveProperty("markerEnd");
  });
});
