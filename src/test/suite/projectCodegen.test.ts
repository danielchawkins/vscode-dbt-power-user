import { describe, expect, it } from "@jest/globals";
import {
  createYMLContent,
  mergeColumnsFromDB,
} from "../../projects/projectCodegen";

describe("projectCodegen", () => {
  it("renders a schema YAML document with one entry per column", () => {
    expect(
      createYMLContent([{ column: "id" }, { column: "name" }], "orders"),
    ).toBe(
      "version: 2\n\nmodels:\n" +
        '  - name: orders\n    description: ""\n    columns:\n' +
        '    - name: id\n      description: ""\n' +
        '    - name: name\n      description: ""\n',
    );
  });

  it("reports no merge when the warehouse returns no columns", () => {
    const node = { columns: {} };
    expect(mergeColumnsFromDB("postgres", node, [])).toBe(false);
    expect(node.columns).toEqual({});
  });

  it("adds warehouse columns and keeps existing data types", () => {
    const node = {
      columns: {
        id: { name: "id", data_type: "BIGINT", description: "key", meta: {} },
        name: { name: "name", description: "", meta: {} },
      } as Record<string, any>,
    };

    const merged = mergeColumnsFromDB("snowflake", node, [
      { column: "ID", dtype: "INTEGER" },
      { column: "NAME", dtype: "TEXT" },
      { column: "CREATED_AT", dtype: "TIMESTAMP" },
    ]);

    expect(merged).toBe(true);
    expect(node.columns.id.data_type).toBe("bigint");
    expect(node.columns.name.data_type).toBe("text");
    expect(node.columns.created_at).toEqual({
      name: "created_at",
      data_type: "timestamp",
      description: "",
      meta: {},
    });
  });
});
