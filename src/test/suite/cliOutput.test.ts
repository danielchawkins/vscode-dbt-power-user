import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import { compiledOutput, parseLogEntries, showPreview } from "../../core/cli";
import { esmDirname } from "../esmDirname";

/** stderr of a `compile` with an SQL error, Fusion 2.0.6, text log format. */
const TEXT_STDERR = readFileSync(
  path.join(
    esmDirname(import.meta.url),
    "fixtures",
    "fusion-compile-2.0.6",
    "strict-sql-error.stderr.txt",
  ),
  "utf8",
);

const log = (level: string, msg: string) =>
  JSON.stringify({ data: {}, info: { level, msg, code: "Z000" } });

/** Hand-built records in the shape Fusion 2.0.6 prints for `show --output json --log-format json`. */
const SHOW_STDOUT = [
  JSON.stringify({
    data: { log_version: 3, version: "=2.0.6" },
    info: { code: "A001", level: "info", msg: "" },
  }),
  JSON.stringify({ data: { sql: "select 0" }, info: { level: "debug" } }),
  JSON.stringify({ data: { sql: "select 1 as id" }, info: { level: "debug" } }),
  JSON.stringify({
    data: {
      columns: ["id", "name"],
      is_inline: true,
      preview: JSON.stringify([
        { id: 1, name: "a" },
        { id: 2, name: null },
      ]),
    },
    info: { code: "Q041", level: "info", name: "ShowNode" },
  }),
].join("\n");

describe("parseLogEntries", () => {
  it("lists errors before warnings and skips other levels and non-JSON lines", () => {
    const stderr = [
      log("warn", "w1"),
      "not json",
      log("info", "i"),
      log("error", "e"),
      "",
      log("fatal", "f"),
      log("warn", "w2"),
      JSON.stringify({ info: { level: "error" } }),
    ].join("\n");
    expect(parseLogEntries(stderr)).toEqual([
      { level: "error", message: "e" },
      { level: "error", message: "f" },
      { level: "warning", message: "w1" },
      { level: "warning", message: "w2" },
    ]);
  });

  it("finds nothing in text-format stderr", () => {
    expect(parseLogEntries(TEXT_STDERR)).toEqual([]);
  });
});

describe("compiledOutput", () => {
  const compiled = (data: object, nodeInfo?: object) =>
    JSON.stringify({ data, info: {}, node_info: nodeInfo });

  it("returns the first compile record", () => {
    const stdout = [
      JSON.stringify({ data: {}, info: {} }),
      compiled({ compiled: "select 1" }),
      compiled({ compiled: "select 2" }),
    ].join("\n");
    expect(compiledOutput(stdout)).toBe("select 1");
  });

  it("prefers the model's record over the tests compiled with it", () => {
    const stdout = [
      compiled({ compiled: "test sql", unique_id: "test.p.t" }),
      compiled({ compiled: "model sql", unique_id: "model.p.a" }),
    ].join("\n");
    expect(compiledOutput(stdout, "model")).toBe("model sql");
    expect(compiledOutput(stdout)).toBe("test sql");
  });

  it("falls back to node_info, then to the first record", () => {
    const byNode = [
      compiled({ compiled: "t" }, { resource_type: "test" }),
      compiled({ compiled: "m" }, { resource_type: "model" }),
    ].join("\n");
    expect(compiledOutput(byNode, "model")).toBe("m");
    expect(compiledOutput(compiled({ compiled: "x" }), "model")).toBe("x");
  });

  it("throws when no record carries compiled output", () => {
    expect(() => compiledOutput(JSON.stringify({ data: {} }))).toThrow();
    expect(() => compiledOutput(TEXT_STDERR)).toThrow();
  });
});

describe("showPreview", () => {
  it("reads columns and rows from the preview and the last compiled SQL", () => {
    expect(showPreview(SHOW_STDOUT)).toEqual({
      columns: ["id", "name"],
      rows: [
        [1, "a"],
        [2, null],
      ],
      compiledSql: "select 1 as id",
    });
  });

  it("returns no columns for an empty preview and no SQL when none was printed", () => {
    expect(showPreview(JSON.stringify({ data: { preview: "[]" } }))).toEqual({
      columns: [],
      rows: [],
      compiledSql: "",
    });
  });

  it("throws when stdout has no preview", () => {
    expect(() => showPreview(JSON.stringify({ data: {} }))).toThrow(
      /Could not find previewLine/,
    );
  });
});
