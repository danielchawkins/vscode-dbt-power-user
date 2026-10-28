import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A shape that crosses the host/webview boundary is declared once, in packages/webview-contract, and both sides import
// it. A same-named interface or type in the host or the webview (with or without a `DBT`/`Dbt` prefix) is a second
// declaration of that shape: the two drift, and only the copy a message is typed with is checked. An alias of the
// contract type (`type ModelTest = documentationEditor.ModelTest`) is an import, not a copy, and so is a view built
// from it (`type ColumnLineage = Omit<lineage.ColumnLineage, "viewsType"> & {...}`), which cannot drift from it.
// BASELINE lists the copies that exist today; the refactor that removes one deletes its entry, and the second test
// fails until it does, so the list only shrinks.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONTRACT = "packages/webview-contract/src";
const SCANNED = ["src", "webview_panels/src"];

const BASELINE = new Set([
  "webview_panels/src/modules/documentationEditor/state/types.ts Documentation",
  "webview_panels/src/modules/documentationEditor/state/types.ts DocumentationColumn",
  "webview_panels/src/modules/lineage/graph.ts ColumnRef",
]);

const isTest = (file: string) =>
  /\.test\.tsx?$/.test(file) || /(^|\/)test\//.test(file);

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => `${dir}/${file.split("\\").join("/")}`)
    .filter((file) => !isTest(file) && !file.includes("node_modules/"));
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** The names of the interfaces and type aliases the contract exports. */
function contractNames(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const match of read(file).matchAll(
      /^export (?:interface|type) (\w+)/gm,
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

/** `"<file> <contract name>"` for each declaration in `text` that copies a contract name instead of aliasing it. */
function copiesIn(
  file: string,
  text: string,
  names: ReadonlySet<string>,
): string[] {
  const found: string[] = [];
  const declaration =
    /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type)\s+(?:DBT|Dbt)?(\w+)(?=\s*(?:<|=|\{|extends))[^\n]*/gm;
  for (const match of text.matchAll(declaration)) {
    const name = match[1];
    const line = match[0];
    const derives = new RegExp(
      `=\\s*(?:(?:Omit|Pick|Partial|Required|NonNullable)<\\s*)?(?:\\w+\\.)?${name}\\b`,
    ).test(line);
    if (names.has(name) && !derives) {
      found.push(`${file} ${name}`);
    }
  }
  return found;
}

describe("copiesIn", () => {
  const names = new Set(["Documentation", "ModelTest", "ColumnLineage"]);
  it("finds a same-named or DBT-prefixed copy and skips an alias, a view or an import", () => {
    const text = [
      "export interface DBTDocumentation {",
      "interface Documentation {",
      "export type DBTModelTest = documentationEditor.ModelTest;",
      "export type ModelTest = ModelTest;",
      'export type ColumnLineage = Omit<lineage.ColumnLineage, "viewsType"> & {',
      "interface DocumentationDraft {",
      'import { type ModelTest, type Documentation } from "x";',
      "  type Documentation,",
    ].join("\n");
    expect(copiesIn("a.ts", text, names)).toEqual([
      "a.ts Documentation",
      "a.ts Documentation",
    ]);
  });
});

describe("contract shapes", () => {
  const names = contractNames(sources(CONTRACT));
  const copies = new Set(
    SCANNED.flatMap(sources).flatMap((file) =>
      copiesIn(file, read(file), names),
    ),
  );

  it("reads the contract's exported types", () => {
    expect(names.has("HostMessage")).toBe(true);
  });

  it("declares no contract shape outside the contract beyond the baseline", () => {
    expect([...copies].filter((copy) => !BASELINE.has(copy))).toEqual([]);
  });

  it("keeps no baseline entry the code no longer has", () => {
    expect([...BASELINE].filter((copy) => !copies.has(copy))).toEqual([]);
  });
});
