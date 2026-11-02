import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  missingEntries,
  unexpectedEntries,
} from "../../../../scripts/quality/vsix-contents.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");

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
        "extension/dist/webview/assets/lineage.js",
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
        "extension/webviews/dist/.gitkeep",
        "extension/mise.toml",
      ]),
    ).toEqual([
      "extension/.dockerignore",
      "extension/docker/integration/Dockerfile",
      "extension/dist/extension.js.map",
      "extension/webviews/dist/.gitkeep",
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

// Checklist 12: the Rust sources and the Node-API binding never reach the VSIX; the WebAssembly engine does. Each plant
// is an entry vsce would write for the file, the way `unzip -Z1` lists it.
describe("Rust outputs stay out of the VSIX (checklist 12)", () => {
  it("plant: a file under crates/ is rejected", () => {
    expect(
      unexpectedEntries([
        "extension/crates/graph-layout-wasm/js/index.mjs",
        "extension/crates/graph-layout/src/lib.rs",
      ]),
    ).toEqual([
      "extension/crates/graph-layout-wasm/js/index.mjs",
      "extension/crates/graph-layout/src/lib.rs",
    ]);
  });

  it("plant: the Node-API binding under dist/graph-layout/ is rejected", () => {
    expect(
      unexpectedEntries(["extension/dist/graph-layout/graph_layout_napi.node"]),
    ).toEqual(["extension/dist/graph-layout/graph_layout_napi.node"]);
  });

  it("accepts the WebAssembly engine under dist/graph-layout/", () => {
    expect(
      unexpectedEntries([
        "extension/dist/graph-layout/graph_layout_wasm_bg.wasm",
        "extension/dist/graph-layout/graph_layout_wasm.js",
      ]),
    ).toEqual([]);
  });

  it("keeps the extension's own bundles in dist/ shipped", () => {
    expect(
      unexpectedEntries([
        "extension/dist/extension.js",
        "extension/dist/webview/assets/lineage.js",
      ]),
    ).toEqual([]);
  });

  // vsce refuses a `!` pattern that matches no file, and `just package` builds no `.node`, so the contents check above
  // is what keeps the binding out.
  it("names dist/graph-layout in package.json files", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { files: string[] };
    expect(manifest.files).toContain("dist/graph-layout/**");
  });
});
