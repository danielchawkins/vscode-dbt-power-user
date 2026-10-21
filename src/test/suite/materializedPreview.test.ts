import { describe, expect, it } from "vitest";
import { materializedPreview } from "../../features/run/materializedPreview";

const node = (materialized: string, packageName = "jaffle") => ({
  name: "orders",
  package_name: packageName,
  config: { materialized },
});

describe("materialized preview", () => {
  it("reads the model through a package-qualified ref, so deferral picks the relation", () => {
    expect(materializedPreview("orders", node("table"))).toEqual({
      kind: "query",
      query: "select * from {{ ref('jaffle', 'orders') }}",
      label: "orders (materialized)",
    });
  });

  it("falls back to a bare ref when the manifest does not know the model", () => {
    expect(materializedPreview("orders", undefined)).toMatchObject({
      query: "select * from {{ ref('orders') }}",
    });
  });

  it("has nothing to read for an ephemeral model", () => {
    expect(materializedPreview("orders", node("ephemeral"))).toEqual({
      kind: "ephemeral",
      name: "orders",
    });
  });

  it("escapes a quote in a name", () => {
    expect(materializedPreview("o'rders", undefined)).toMatchObject({
      query: "select * from {{ ref('o\\'rders') }}",
    });
  });
});
