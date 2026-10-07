import { describe, expect, it } from "vitest";
import { inferredColumns, panelColumns } from "../../core/lineage";

const T = "model.p.order_totals";

describe("inferredColumns", () => {
  it("reads names and lowercased types in server order", () => {
    expect(
      inferredColumns({
        node: {
          columns: {
            customer_id: { data_type: "INTEGER" },
            total: { data_type: "decimal(38,2)" },
            odd: null,
          },
        },
      }),
    ).toEqual([
      { name: "customer_id", datatype: "integer" },
      { name: "total", datatype: "decimal(38,2)" },
      { name: "odd", datatype: "" },
    ]);
  });

  it("is undefined when the server names no node", () => {
    expect(inferredColumns(null)).toBeUndefined();
    expect(inferredColumns({ node: null })).toBeUndefined();
    expect(inferredColumns({ node: {} })).toBeUndefined();
  });
});

describe("panelColumns", () => {
  it("lists declared columns by name when nothing is inferred", () => {
    expect(
      panelColumns(T, [
        { name: "b", data_type: "INT", description: "B" },
        { name: "a", description: "A" },
      ]).map((c) => [c.name, c.datatype, c.description]),
    ).toEqual([
      ["a", "", "A"],
      ["b", "int", "B"],
    ]);
  });

  it("keeps server order, merges declared metadata by name, and appends declared-only columns", () => {
    const columns = panelColumns(
      T,
      [
        { name: "Total", description: "Sum", data_type: "" },
        { name: "n", description: "Count", data_type: "NUMBER" },
        { name: "gone", description: "Only in YAML" },
      ],
      [
        { name: "customer_id", datatype: "integer" },
        { name: "total", datatype: "decimal(38,2)" },
        { name: "n", datatype: "bigint" },
      ],
    );
    expect(columns).toEqual([
      {
        table: T,
        name: "customer_id",
        datatype: "integer",
        can_lineage_expand: false,
        description: "",
      },
      {
        table: T,
        name: "total",
        datatype: "decimal(38,2)",
        can_lineage_expand: false,
        description: "Sum",
      },
      {
        table: T,
        name: "n",
        datatype: "number",
        can_lineage_expand: false,
        description: "Count",
      },
      {
        table: T,
        name: "gone",
        datatype: "",
        can_lineage_expand: false,
        description: "Only in YAML",
      },
    ]);
  });

  it("keeps every declared column when the server infers none", () => {
    const declared = [{ name: "id", data_type: "INT", description: "key" }];
    const expected = [
      {
        table: T,
        name: "id",
        datatype: "int",
        can_lineage_expand: false,
        description: "key",
      },
    ];
    expect(panelColumns(T, declared, [])).toEqual(expected);
    expect(panelColumns(T, declared, undefined)).toEqual(expected);
  });
});
