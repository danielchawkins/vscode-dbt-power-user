import { describe, expect, it } from "vitest";
import {
  claim,
  findMissing,
  spans,
} from "../../../../scripts/quality/docs-symbols.mjs";

describe("claim", () => {
  it("checks camelCase and PascalCase identifiers", () => {
    expect(claim("QueryManifestService")).toEqual({
      kind: "symbol",
      value: "QueryManifestService",
    });
    expect(claim("Project.onDidChangeManifest")).toEqual({
      kind: "symbol",
      value: "onDidChangeManifest",
    });
  });

  it("checks repository paths and drops line suffixes", () => {
    expect(claim("src/core/log.ts:12")).toEqual({
      kind: "path",
      value: "src/core/log.ts",
    });
  });

  it("ignores words, commands and globs", () => {
    expect(claim("dbt")).toBeUndefined();
    expect(claim("just check")).toBeUndefined();
    expect(claim("src/**/*.ts")).toBeUndefined();
  });
});

describe("findMissing", () => {
  const docs = [{ file: "a.md", text: "`realThing` and `bogusThing`\n" }];

  it("reports a symbol absent from the corpus", () => {
    expect(
      findMissing(docs, "const realThing = 1", () => true, new Set()),
    ).toEqual(["a.md:1: `bogusThing`"]);
  });

  it("skips allowed names and fenced code", () => {
    expect(
      findMissing(docs, "realThing", () => true, new Set(["bogusThing"])),
    ).toEqual([]);
    expect(spans("```\n`x`\n```\n")).toEqual([]);
  });
});
