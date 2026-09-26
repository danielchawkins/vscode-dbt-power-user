import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  ColumnEdge,
  parseColumnLineage,
  toPanelLineage,
} from "../../fusion/columnLineage";
import { esmDirname } from "../esmDirname";

const FUSION_2_0_6_STDOUT = readFileSync(
  path.join(
    esmDirname(import.meta.url),
    "fixtures",
    "fusion-show-column-lineage-2.0.6.txt",
  ),
  "utf8",
);

const edge = (
  parent: string,
  child: string,
  evolution: ColumnEdge["evolution"],
): ColumnEdge => {
  const [parentId, parentColumn] = parent.split(":");
  const [childId, childColumn] = child.split(":");
  return {
    parent: { uniqueId: parentId, column: parentColumn },
    child: { uniqueId: childId, column: childColumn },
    evolution,
    ingestedAt: "2026-09-25T00:00:00Z",
  };
};

describe("parseColumnLineage", () => {
  it("reads the array between Fusion 2.0.6 log lines", () => {
    const edges = parseColumnLineage(FUSION_2_0_6_STDOUT);

    expect(edges).toHaveLength(5);
    expect(edges[0]).toEqual({
      parent: { uniqueId: "source.schema_probe.raw.orders", column: "amount" },
      child: { uniqueId: "model.schema_probe.stg_orders", column: "amount" },
      evolution: "copy",
      ingestedAt: expect.any(String),
    });
    expect(edges.map((e) => e.evolution)).toEqual([
      "copy",
      "mod",
      "scan",
      "copy",
      "scan",
    ]);
  });

  it("accepts the from_/to_/lineage_kind column set", () => {
    const stdout = JSON.stringify([
      {
        from_node_unique_id: "model.p.a",
        from_column_name: "x",
        to_node_unique_id: "model.p.b",
        to_column_name: "y",
        lineage_kind: "mod",
        ingested_at: "t",
      },
    ]);

    expect(parseColumnLineage(stdout)).toEqual([
      {
        parent: { uniqueId: "model.p.a", column: "x" },
        child: { uniqueId: "model.p.b", column: "y" },
        evolution: "mod",
        ingestedAt: "t",
      },
    ]);
  });

  it.each([
    ["empty stdout", ""],
    ["log lines only", "dbt 2.0.6\nFinished 'show' successfully [10ms]\n"],
    ["an empty array", "dbt 2.0.6\n[]\nFinished\n"],
  ])("returns no edges for %s", (_, stdout) => {
    expect(parseColumnLineage(stdout)).toEqual([]);
  });

  it("ignores bracketed log text before the array", () => {
    const stdout =
      "[warn] cache miss\n" +
      JSON.stringify([
        {
          parent_node_unique_id: "model.p.a",
          parent_column_name: "x",
          child_node_unique_id: "model.p.b",
          child_column_name: "x",
          evolution: "copy",
          ingested_at: "t",
        },
      ]) +
      "\n[done]\n";

    expect(parseColumnLineage(stdout)).toHaveLength(1);
  });

  it("drops unknown rows and reports them once", () => {
    const report = jest.fn();
    const stdout = JSON.stringify([
      {
        parent_node_unique_id: "model.p.a",
        parent_column_name: "x",
        child_node_unique_id: "model.p.b",
        child_column_name: "x",
        evolution: "teleport",
        ingested_at: "t",
      },
      { unrelated: true },
      {
        parent_node_unique_id: "model.p.a",
        parent_column_name: "x",
        child_node_unique_id: "model.p.b",
        child_column_name: "y",
        evolution: "scan",
        ingested_at: "t",
      },
    ]);

    const edges = parseColumnLineage(stdout, report);

    expect(edges.map((e) => e.child.column)).toEqual(["y"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("2");
  });

  it("does not report when every row is known", () => {
    const report = jest.fn();
    parseColumnLineage(FUSION_2_0_6_STDOUT, report);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("toPanelLineage", () => {
  const identity = (uniqueId: string) => uniqueId;

  it.each([
    [
      "copy, same name",
      edge("m.a:id", "m.b:id", "copy"),
      "direct",
      "Unchanged",
    ],
    [
      "copy, different name",
      edge("m.a:name", "m.b:label", "copy"),
      "direct",
      "Alias",
    ],
    ["mod", edge("m.a:x", "m.b:y", "mod"), "direct", "Transformation"],
    ["scan", edge("m.a:k", "m.b:y", "scan"), "indirect", "Non select"],
  ])("maps %s", (_, input, type, viewsType) => {
    expect(toPanelLineage([input], identity)).toEqual([
      {
        source: [input.parent.uniqueId, input.parent.column],
        target: [input.child.uniqueId, input.child.column],
        type,
        viewsType,
      },
    ]);
  });

  it("resolves unique IDs through the table lookup", () => {
    const lookup = (uniqueId: string) => `table:${uniqueId}`;

    expect(toPanelLineage([edge("m.a:x", "m.b:x", "copy")], lookup)).toEqual([
      expect.objectContaining({
        source: ["table:m.a", "x"],
        target: ["table:m.b", "x"],
      }),
    ]);
  });

  it("drops edges whose parent or child has no table", () => {
    const known = new Set(["m.a", "m.b"]);
    const lookup = (uniqueId: string) =>
      known.has(uniqueId) ? uniqueId : undefined;

    const lineage = toPanelLineage(
      [
        edge("m.a:x", "m.b:x", "copy"),
        edge("m.gone:x", "m.b:x", "copy"),
        edge("m.a:x", "m.gone:x", "copy"),
      ],
      lookup,
    );

    expect(lineage).toHaveLength(1);
  });

  it("maps the Fusion 2.0.6 fixture end to end", () => {
    const lineage = toPanelLineage(
      parseColumnLineage(FUSION_2_0_6_STDOUT),
      identity,
    );

    expect(lineage.map((l) => l.viewsType)).toEqual([
      "Unchanged",
      "Transformation",
      "Non select",
      "Alias",
      "Non select",
    ]);
  });
});
