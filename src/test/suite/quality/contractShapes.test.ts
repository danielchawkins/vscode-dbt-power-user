import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A shape that crosses the host/webview boundary is declared once, in packages/webview-contract, and both sides import
// it. A same-named interface or type in the host or the webview (with or without a `DBT`/`Dbt` prefix) is a second
// declaration of that shape: the two drift, and only the copy a message is typed with is checked. An exact alias of
// the contract type (`type ModelTest = documentationEditor.ModelTest;`) is an import, not a copy. Any other
// declaration with the same name is a copy, including an `Omit<…>`, `Pick<…>` or intersection that re-declares
// fields, unless it is listed in ALLOWED_VIEWS with the reason it narrows the contract on purpose.
// BASELINE lists the copies that exist today; the refactor that removes one deletes its entry, and `keeps no baseline
// entry the code no longer has` fails until it does, so the list only shrinks.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CONTRACT = "packages/webview-contract/src";
const SCANNED = ["src", "webviews/src"];

/**
 * Views of a contract shape that are intended: `"<file> <name>"` to the text its declaration must start with after the
 * `=`, so a field-by-field copy under the same name is still reported.
 */
const ALLOWED_VIEWS = new Map([
  // Narrows only `viewsType`, to the core's own union; every other field is the contract's.
  [
    "src/core/lineage/columnLineage.ts ColumnLineage",
    "Omit<lineage.ColumnLineage,",
  ],
]);

const BASELINE = new Set<string>([]);

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
    const alias = new RegExp(`=\\s*(?:\\w+\\.)?${name}\\s*;`).test(line);
    const view = ALLOWED_VIEWS.get(`${file} ${name}`);
    const allowed =
      view !== undefined && line.replace(/^[^=]*=\s*/, "").startsWith(view);
    if (names.has(name) && !alias && !allowed) {
      found.push(`${file} ${name}`);
    }
  }
  return found;
}

describe("copiesIn", () => {
  const names = new Set(["Documentation", "ModelTest", "ColumnLineage"]);
  it("finds a same-named or DBT-prefixed copy, and a view that re-declares fields", () => {
    const text = [
      "export interface DBTDocumentation {",
      "interface Documentation {",
      'export type Documentation = Omit<documentationEditor.Documentation, "description"> & {',
      "  description: string;",
      "};",
      "type Documentation = Omit<Documentation, keyof Documentation> & { columns: string[] };",
      'export type ColumnLineage = Omit<lineage.ColumnLineage, "viewsType"> & {',
    ].join("\n");
    expect(copiesIn("a.ts", text, names)).toEqual([
      "a.ts Documentation",
      "a.ts Documentation",
      "a.ts Documentation",
      "a.ts Documentation",
      "a.ts ColumnLineage",
    ]);
  });
  it("reports a listed view's name when it is re-declared field by field", () => {
    expect(
      copiesIn(
        "src/core/lineage/columnLineage.ts",
        "export interface ColumnLineage { source: [string, string]; }",
        names,
      ),
    ).toEqual(["src/core/lineage/columnLineage.ts ColumnLineage"]);
  });
  it("skips an exact alias, an import, and a listed view", () => {
    const text = [
      "export type DBTModelTest = documentationEditor.ModelTest;",
      "export type ModelTest = ModelTest;",
      'import { type ModelTest, type Documentation } from "x";',
      "  type Documentation,",
      "interface DocumentationDraft {",
    ].join("\n");
    expect(copiesIn("a.ts", text, names)).toEqual([]);
    expect(
      copiesIn(
        "src/core/lineage/columnLineage.ts",
        'export type ColumnLineage = Omit<lineage.ColumnLineage, "viewsType"> & {',
        names,
      ),
    ).toEqual([]);
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

  it("keeps no allowed view the code no longer declares", () => {
    const stale = [...ALLOWED_VIEWS].filter(([key, prefix]) => {
      const [file, name] = key.split(" ");
      const text = file === undefined ? "" : read(file);
      return !new RegExp(
        `^export type ${name} = ${prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "m",
      ).test(text);
    });
    expect(stale).toEqual([]);
  });
});
