import { describe, expect, it } from "vitest";
import {
  modelAt,
  modelNameKeys,
  positionAt,
  sourceTables,
} from "../../core/yaml/schemaYaml";

const BLOCK_MODELS = [
  "version: 2",
  "models:",
  "  - name: orders",
  "    description: x",
  "  - name: customers",
];

describe("schema YAML walker", () => {
  it("names each model by its name key, with the key's offset and range", () => {
    const text = BLOCK_MODELS.join("\n");
    const offset = text.indexOf("orders");

    expect(modelNameKeys(text)).toEqual([
      { name: "orders", offset: offset - 6, range: [offset - 6, offset - 2] },
      {
        name: "customers",
        offset: text.indexOf("customers") - 6,
        range: [text.indexOf("customers") - 6, text.indexOf("customers") - 2],
      },
    ]);
  });

  it("reads flow-style models the same as block-style ones", () => {
    const text = "models: [{name: a, description: x}, {name: 'b'}]\n";

    expect(modelNameKeys(text).map((key) => key.name)).toEqual(["a", "b"]);
    expect(modelNameKeys(text)[1]?.offset).toBe(text.indexOf("name: 'b'"));
  });

  it("returns the model whose entry holds the offset, and none outside every entry", () => {
    const text = BLOCK_MODELS.join("\n");

    expect(modelAt(text, text.indexOf("description"))?.name).toBe("orders");
    expect(modelAt(text, text.indexOf("customers") + 3)?.name).toBe(
      "customers",
    );
    expect(modelAt(text, 0)).toBeUndefined();
  });

  it("finds the model inside a flow-style entry", () => {
    const text = "models: [{name: a, description: x}, {name: b}]\n";

    expect(modelAt(text, text.indexOf("description"))?.name).toBe("a");
    expect(modelAt(text, text.indexOf("name: b") + 1)?.name).toBe("b");
  });

  it("reads the source tables with their database, schema, identifier and offsets", () => {
    const text = [
      "sources:",
      "  - name: raw",
      "    database: db",
      "    schema: s",
      "    tables:",
      "      - description: d",
      "        name: orders",
      "      - name: customers",
      "        identifier: cust_tbl",
    ].join("\n");

    expect(sourceTables(text)).toEqual([
      {
        source: "raw",
        database: "db",
        schema: "s",
        table: "orders",
        identifier: undefined,
        offset: text.indexOf("description"),
        nameOffset: text.indexOf("orders"),
      },
      {
        source: "raw",
        database: "db",
        schema: "s",
        table: "customers",
        identifier: "cust_tbl",
        offset: text.indexOf("name: customers"),
        nameOffset: text.indexOf("customers"),
      },
    ]);
  });

  it("reads flow-style sources and tables", () => {
    const text =
      "sources: [{name: raw, tables: [{name: t1}, {name: t2, identifier: t2_id}]}]\n";

    expect(
      sourceTables(text).map((table) => [
        table.source,
        table.table,
        table.identifier,
      ]),
    ).toEqual([
      ["raw", "t1", undefined],
      ["raw", "t2", "t2_id"],
    ]);
    expect(sourceTables(text)[0]?.offset).toBe(text.indexOf("{name: t1}"));
  });

  it("skips the tables of a source that has no name", () => {
    expect(
      sourceTables(
        "sources:\n  - database: db\n    tables:\n      - name: orphan\n",
      ),
    ).toEqual([]);
  });

  it("reads nothing from text that has no models or sources, or that fails to parse", () => {
    expect(modelNameKeys("")).toEqual([]);
    expect(sourceTables("# only a comment\n")).toEqual([]);
    expect(modelNameKeys("other:\n  models:\n    - name: nope\n")).toEqual([]);
    expect(modelAt("models:\n  - name: [unclosed", 12)).toBeUndefined();
  });

  it("skips a model whose name is null or not a scalar", () => {
    expect(
      modelNameKeys("models:\n  - name:\n  - name: {a: 1}\n  - name: ok\n").map(
        (key) => key.name,
      ),
    ).toEqual(["ok"]);
  });

  it("keeps a model's name key on its own line when the text uses CRLF", () => {
    const text = "models:\r\n  - name: a\r\n  - name: b\r\n";
    const [, second] = modelNameKeys(text);

    expect(second && positionAt(text, second.offset)).toEqual({
      line: 2,
      character: 4,
    });
  });

  it("maps an offset to a zero-based line and character", () => {
    expect(positionAt("ab\ncd", 0)).toEqual({ line: 0, character: 0 });
    expect(positionAt("ab\ncd", 4)).toEqual({ line: 1, character: 1 });
  });
});
