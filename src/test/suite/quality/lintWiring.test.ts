import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Each workspace that has an Oxlint config runs it in its `just` lint recipe. ESLint's `eslint-plugin-oxlint`
// preset turns off every rule Oxlint implements (max-lines, max-params, complexity among them), so a workspace
// whose lint recipe skips Oxlint enforces none of those rules.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The command lines of `recipe` in the justfile at `dir`: the indented lines below its header. */
function recipeBody(justfile: string, recipe: string): string[] {
  const lines = justfile.split("\n");
  const header = new RegExp(`^${recipe}(\\s[^:]*)?:`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) {
    return [];
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line) || line.trim() === "") {
      break;
    }
    body.push(line.trim());
  }
  return body;
}

const read = (dir: string) => readFileSync(join(ROOT, dir, "justfile"), "utf8");

describe("recipeBody", () => {
  it("returns the indented lines below the header, up to the first blank line", () => {
    const justfile = "a:\n    one\n    two\n\nb *args:\n    three\n";
    expect(recipeBody(justfile, "a")).toEqual(["one", "two"]);
    expect(recipeBody(justfile, "b")).toEqual(["three"]);
    expect(recipeBody(justfile, "c")).toEqual([]);
  });
});

describe("lint wiring", () => {
  it("runs the host Oxlint config in lint-code", () => {
    expect(recipeBody(read("."), "lint-code")).toContain("npm run lint:oxlint");
  });

  it("runs the webview Oxlint config in webviews::lint", () => {
    expect(recipeBody(read("webviews"), "lint")).toContain(
      "npm run lint:oxlint",
    );
  });

  it("applies the webview Oxlint fixes in webviews::fmt", () => {
    expect(recipeBody(read("webviews"), "fmt")).toContain("npm run fix:oxlint");
  });
});
