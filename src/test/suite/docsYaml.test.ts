import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import type { TestDataDeps } from "../../features/docs/docsTestData";
import type { SaveInput } from "../../features/docs/docsYaml";
import { withDocumentation } from "../../features/docs/docsYaml";

const deps = {
  terminal: { debug: vi.fn() },
  dbtTestService: {},
} as never as TestDataDeps;

const schema = `version: 2
models:
  - name: orders
    columns:
      - name: id
        data_type: varchar
      - name: total
`;

/** `schema` written for `message`, parsed back to its models. */
function write(message: Partial<SaveInput>, docFile = schema) {
  const saved = withDocumentation(
    docFile,
    { name: "orders", columns: [], ...message },
    "duckdb",
    deps,
  );
  return parse(saved).models as {
    name: string;
    columns: { name: string; data_type?: string }[];
  }[];
}

describe("withDocumentation column types", () => {
  it("keeps an existing data_type when the column's type differs", () => {
    const [model] = write({
      columns: [{ name: "id", type: "integer" }],
    });

    expect(model.columns[0]).toEqual({ name: "id", data_type: "varchar" });
  });

  it("fills an empty data_type without replaceType", () => {
    const [model] = write({
      columns: [{ name: "total", type: "DECIMAL" }],
    });

    expect(model.columns[1]).toEqual({ name: "total", data_type: "decimal" });
  });

  it("replaces an existing data_type with replaceType, lowercased", () => {
    const [model] = write({
      columns: [{ name: "id", type: "INTEGER", replaceType: true }],
    });

    expect(model.columns[0]).toEqual({ name: "id", data_type: "integer" });
  });

  it("keeps the existing data_type when replaceType comes without a type", () => {
    const [model] = write({
      columns: [{ name: "id", type: "", replaceType: true }],
    });

    expect(model.columns[0]).toEqual({ name: "id", data_type: "varchar" });
  });

  it("gives a new column in an existing model its data_type", () => {
    const [model] = write({
      columns: [{ name: "status", type: "VARCHAR" }],
    });

    expect(model.columns.at(-1)).toEqual({
      name: "status",
      data_type: "varchar",
    });
  });

  it("gives the columns of a new model their data_type", () => {
    const models = write(
      {
        name: "customers",
        columns: [{ name: "id", type: "Integer" }],
      },
      schema,
    );

    expect(models[1]).toMatchObject({
      name: "customers",
      columns: [{ name: "id", data_type: "integer" }],
    });
  });
});
