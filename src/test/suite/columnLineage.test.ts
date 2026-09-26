import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  buildLineageQuery,
  classifyLineageRead,
  ColumnEdge,
  parseLineageRows,
  toPanelLineage,
} from "../../fusion/columnLineage";
import { esmDirname } from "../esmDirname";

/** stdout of experiment r9 step 04 (upstream of order_totals), Fusion 2.0.6. */
const FUSION_2_0_6_STDOUT = readFileSync(
  path.join(
    esmDirname(import.meta.url),
    "fixtures",
    "fusion-show-inline-lineage-2.0.6.json",
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
  };
};

const row = (childColumn: string, evolution: string) => ({
  parent_node_unique_id: "model.p.a",
  parent_column_name: "x",
  child_node_unique_id: "model.p.b",
  child_column_name: childColumn,
  evolution,
});

describe("buildLineageQuery", () => {
  it("filters upstream edges on the child", () => {
    expect(buildLineageQuery(["model.p.a", "model.p.b"], "upstream")).toBe(
      [
        "select parent_node_unique_id, parent_column_name, child_node_unique_id, child_column_name, evolution",
        "from {{ info_schema('column_lineage') }}",
        "where child_node_unique_id in ('model.p.a', 'model.p.b')",
      ].join("\n"),
    );
  });

  it("filters downstream edges on the parent", () => {
    expect(buildLineageQuery(["model.p.a"], "downstream")).toContain(
      "where parent_node_unique_id in ('model.p.a')",
    );
  });

  it("doubles single quotes", () => {
    expect(buildLineageQuery(["model.p.o'brien"], "upstream")).toContain(
      "('model.p.o''brien')",
    );
  });
});

describe("parseLineageRows", () => {
  it("reads the Fusion 2.0.6 inline stdout", () => {
    const edges = parseLineageRows(FUSION_2_0_6_STDOUT);

    expect(edges).toHaveLength(6);
    expect(edges[0]).toEqual({
      parent: {
        uniqueId: "model.lineage_probe.stg_orders",
        column: "customer_id",
      },
      child: {
        uniqueId: "model.lineage_probe.order_totals",
        column: "customer_id",
      },
      evolution: "copy",
    });
  });

  it("returns no edges for an empty array", () => {
    expect(parseLineageRows("[]\n")).toEqual([]);
  });

  it.each([
    ["empty stdout", ""],
    ["a log line", "dbt 2.0.6\n[]"],
    ["an object", "{}"],
  ])("throws on %s", (_, stdout) => {
    expect(() => parseLineageRows(stdout)).toThrow();
  });

  it("drops unknown rows, including the from_/to_ column set, and reports them once", () => {
    const report = jest.fn();
    const stdout = JSON.stringify([
      row("x", "teleport"),
      {
        from_node_unique_id: "model.p.a",
        from_column_name: "x",
        to_node_unique_id: "model.p.b",
        to_column_name: "y",
        lineage_kind: "mod",
      },
      row("y", "scan"),
    ]);

    const edges = parseLineageRows(stdout, report);

    expect(edges.map((e) => e.child.column)).toEqual(["y"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("2");
  });

  it("does not report when every row is known", () => {
    const report = jest.fn();
    parseLineageRows(FUSION_2_0_6_STDOUT, report);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("classifyLineageRead", () => {
  it("returns edges for exit 0 with rows", () => {
    const read = classifyLineageRead({
      exitCode: 0,
      stdout: FUSION_2_0_6_STDOUT,
      stderr: "",
    });
    expect(read.kind).toBe("edges");
  });

  it("returns empty for exit 0 with []", () => {
    expect(
      classifyLineageRead({ exitCode: 0, stdout: "[]\n", stderr: "" }),
    ).toEqual({ kind: "empty" });
  });

  it("returns unavailable for dbt1656", () => {
    // stderr of experiment r9 step 02, before any compile.
    const stderr =
      "\n\n=================== Errors and Warnings ====================\n" +
      "[error] [InfoSchemaUnavailable (dbt1656)]: no project metadata at /p/target/private/metadata";
    expect(classifyLineageRead({ exitCode: 1, stdout: "", stderr })).toEqual({
      kind: "unavailable",
    });
  });

  it("returns failed with stderr for another non-zero exit", () => {
    expect(
      classifyLineageRead({ exitCode: 2, stdout: "", stderr: "boom\n" }),
    ).toEqual({ kind: "failed", message: "boom" });
  });

  it("returns failed when exit 0 stdout is not a JSON array", () => {
    const read = classifyLineageRead({
      exitCode: 0,
      stdout: "dbt 2.0.6\n",
      stderr: "",
    });
    expect(read.kind).toBe("failed");
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
      parseLineageRows(FUSION_2_0_6_STDOUT),
      identity,
    );

    expect(lineage.map((l) => l.viewsType)).toEqual([
      "Unchanged",
      "Alias",
      "Non select",
      "Non select",
      "Transformation",
      "Non select",
    ]);
  });
});
