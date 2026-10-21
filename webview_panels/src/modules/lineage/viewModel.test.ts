import type { lineage } from "@fusion-power-user/webview-contract";
import type { LineageViewState } from "@modules/app/viewState";
import { MAX_VIEW_STATE_STRING } from "@modules/app/viewState";
import { describe, expect, it } from "vitest";
import { addNeighbours, emptyGraph } from "./graph";
import { groupNodeId } from "./grouping";
import {
  planRender,
  resolveSettings,
  viewStateOf,
  visibleRefs,
} from "./viewModel";

const table = (id: string): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType: "model",
  childCount: 1,
  parentCount: 0,
  tests: [],
});

const saved: LineageViewState = {
  panel: "lineage",
  publication: "s:1",
  start: "a",
  expansions: ["c:a"],
  columnTables: ["b"],
  selectedTable: "b",
  selectedColumn: ["b", "id"],
};

const render = (start: string | undefined, publication = "s:1") => ({
  node: start ? table(start) : undefined,
  publication,
});

describe("lineage view model", () => {
  it("replays the kept view state on the first render of the same start and publication", () => {
    const plan = planRender({
      args: render("a"),
      graph: emptyGraph(),
      publication: undefined,
      refresh: false,
      stored: () => saved,
    });
    expect(plan?.start?.table).toBe("a");
    expect(plan?.saved).toBe(saved);
  });

  it("draws at the default expansion when the kept state names another start or publication", () => {
    for (const args of [render("b"), render("a", "s:2")]) {
      const plan = planRender({
        args,
        graph: emptyGraph(),
        publication: undefined,
        refresh: false,
        stored: () => saved,
      });
      expect(plan?.saved).toBeUndefined();
    }
  });

  it("ignores a render of the drawn start at the drawn publication", () => {
    expect(
      planRender({
        args: render("a"),
        graph: emptyGraph(table("a")),
        publication: "s:1",
        refresh: false,
        stored: () => saved,
      }),
    ).toBeUndefined();
  });

  it("replays the drawn expansions after a project save", () => {
    const graph = addNeighbours(emptyGraph(table("a")), "children", "a", [
      table("b"),
    ]);
    const plan = planRender({
      args: render("a", "s:2"),
      graph,
      publication: "s:1",
      refresh: true,
      stored: () => undefined,
    });
    expect(plan?.saved?.expansions).toEqual(["c:a"]);
  });

  it("clears the graph when no start table resolves", () => {
    expect(
      planRender({
        args: render(undefined),
        graph: emptyGraph(table("a")),
        publication: "s:1",
        refresh: false,
        stored: () => undefined,
      }),
    ).toEqual({});
  });

  it("persists only expansion, column lists, selection and open groups", () => {
    const state = viewStateOf(
      { ...emptyGraph(table("a")), selectedColumn: ["a", "id"] },
      "s:1",
    );
    expect(Object.keys(state!).sort()).toEqual([
      "columnTables",
      "expansions",
      "openGroups",
      "panel",
      "publication",
      "selectedColumn",
      "selectedTable",
      "start",
    ]);
    expect(viewStateOf(emptyGraph(), "s:1")).toBeUndefined();
  });

  it("persists the open groups, leaving out an ID too long to keep", () => {
    const drawn = addNeighbours(emptyGraph(table("a")), "children", "a", [
      table("b"),
      table("c"),
    ]);
    const kept = groupNodeId("c:a", "pkg:models/marts");
    const longKey = "k".repeat(
      MAX_VIEW_STATE_STRING + 1 - groupNodeId("c:a", "").length,
    );
    expect(groupNodeId("c:a", longKey)).toHaveLength(MAX_VIEW_STATE_STRING + 1);
    const state = viewStateOf(
      {
        ...drawn,
        groups: {
          "c:a": {
            buckets: [
              { key: longKey, members: ["b"] },
              { key: "pkg:models/marts", members: ["c"] },
            ],
            loose: [],
            open: { [longKey]: 1, "pkg:models/marts": 1 },
          },
        },
      },
      "s:1",
    );
    expect(state?.openGroups).toEqual([kept]);
  });

  it("filters relationships by source, confidence and drawn ends", () => {
    const ref = (
      id: string,
      source: lineage.RefSource,
      to = "b",
      confidence?: number,
    ): lineage.LineageRef => ({
      id,
      source,
      confidence,
      cardinality: "many-to-one",
      from: { table: "a", columns: ["b_id"] },
      to: { table: to, columns: ["id"] },
    });
    const refs = [
      ref("t", "test"),
      ref("low", "inferred", "b", 0.7),
      ref("high", "inferred", "b", 0.9),
      ref("off", "semantic"),
      ref("undrawn", "test", "z"),
    ];
    const settings = resolveSettings({
      enabledRefSources: { semantic: false },
    });
    expect(
      visibleRefs(refs, settings, new Set(["a", "b"])).map((r) => r.id),
    ).toEqual(["t", "high"]);
    expect(
      visibleRefs(refs, { ...settings, showRefs: false }, new Set(["a", "b"])),
    ).toEqual([]);
  });
});
