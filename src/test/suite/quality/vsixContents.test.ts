import { describe, expect, it } from "vitest";
import {
  missingEntries,
  unexpectedEntries,
} from "../../../../scripts/quality/vsix-contents.mjs";

describe("unexpectedEntries", () => {
  it("accepts the fixed vsce entries and files under a shipped directory", () => {
    expect(
      unexpectedEntries([
        "extension.vsixmanifest",
        "[Content_Types].xml",
        "extension/package.json",
        "extension/readme.md",
        "extension/LICENSE.txt",
        "extension/dist/extension.js",
        "extension/media/images/dbt.png",
        "extension/syntaxes/jinja-sql.tmLanguage.json",
        "extension/snippets/snippets_sql.json",
        "extension/webview_panels/dist/assets/lineage.js",
        "",
      ]),
    ).toEqual([]);
  });

  it("reports contributor tooling, source maps and placeholders", () => {
    expect(
      unexpectedEntries([
        "extension/.dockerignore",
        "extension/docker/integration/Dockerfile",
        "extension/dist/extension.js.map",
        "extension/webview_panels/dist/.gitkeep",
        "extension/mise.toml",
      ]),
    ).toEqual([
      "extension/.dockerignore",
      "extension/docker/integration/Dockerfile",
      "extension/dist/extension.js.map",
      "extension/webview_panels/dist/.gitkeep",
      "extension/mise.toml",
    ]);
  });
});

describe("missingEntries", () => {
  it("reports a fixed entry the VSIX lacks", () => {
    expect(
      missingEntries([
        "extension.vsixmanifest",
        "[Content_Types].xml",
        "extension/package.json",
        "extension/readme.md",
      ]),
    ).toEqual(["extension/LICENSE.txt"]);
  });
});
