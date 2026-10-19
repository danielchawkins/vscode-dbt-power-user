import { describe, expect, it } from "vitest";
import { columnsQuery, describeQuery, parseDescribed } from "../../core/cli";

describe("columnsQuery", () => {
  it("keeps the text it had in fusionCli.ts", () => {
    expect(columnsQuery("ref('m')")).toBe(
      "{% set output = [] %}{% for result in adapter.get_columns_in_relation(ref('m')) %} " +
        '{% do output.append({"column": result.name, "dtype": result.dtype}) %} {% endfor %} {{ tojson(output) }}',
    );
  });
});

describe("describeQuery", () => {
  it("lists the columns of the relation and renders target, relation and columns as JSON", () => {
    const query = describeQuery("ref('m')");
    expect(query).toContain(
      "{% for result in adapter.get_columns_in_relation(ref('m')) %}",
    );
    expect(query).toContain(
      '{{ tojson({"target": target.name, "relation": ref(\'m\')|string, "columns": output}) }}',
    );
  });
});

describe("parseDescribed", () => {
  const described = {
    target: "dev",
    relation: '"probe"."main"."m"',
    columns: [{ column: "id", dtype: "INTEGER" }],
  };

  it("reads valid output", () => {
    expect(parseDescribed(JSON.stringify(described))).toEqual(described);
  });

  it("accepts empty columns, which is what a missing relation gives", () => {
    const missing = { ...described, columns: [] };
    expect(parseDescribed(JSON.stringify(missing))).toEqual(missing);
  });

  it("throws on a malformed shape", () => {
    const malformed = [
      { target: "dev", relation: "r" },
      { ...described, columns: "id" },
      { ...described, columns: [{ column: "id" }] },
      { ...described, columns: [{ column: 1, dtype: "INTEGER" }] },
      { ...described, target: 3 },
      { ...described, relation: undefined },
      ["dev", "r", []],
      null,
    ];
    for (const value of malformed) {
      expect(() => parseDescribed(JSON.stringify(value))).toThrow(
        "lacks a target, a relation or a list of {column, dtype} columns",
      );
    }
  });

  it("throws on text that is not JSON", () => {
    expect(() => parseDescribed("Compilation Error: boom")).toThrow(
      "not JSON",
    );
  });
});
