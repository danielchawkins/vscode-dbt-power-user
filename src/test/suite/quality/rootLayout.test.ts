import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every file at the repository root sits in an Explorer nesting group of .vscode/settings.json, so adding a root
// file is a visible decision in review, and every name a group lists exists.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * The top-level directories and what each holds. A new one is a layout decision: record it here and in
 * docs/adr/0010-repository-layout.md rather than adding it in passing.
 */
const ROOT_DIRECTORIES = new Set([
  ".agents", // agent skills; .claude links here
  ".claude",
  ".github", // CI workflows and issue templates
  ".vscode", // shared editor settings and launch configurations
  "ast-grep", // ast-grep rules and their tests, read through sgconfig.yml
  "docker", // integration and smoke images
  "docs", // ADRs, plans, research and reference docs
  "lint", // lint lists shared by Oxlint and ESLint, and the must-fire lint fixtures
  "media", // shipped icons
  "packages", // TypeScript libraries built by build:packages
  "scripts", // contributor tooling that Just and CI run, and research harnesses
  "snippets", // shipped snippets
  "src", // the extension host and its tests
  "syntaxes", // shipped TextMate grammars
  "webview_panels", // the webview app, bundled by Vite
]);

/** Local, untracked overrides that a group may list before they exist. */
const OPTIONAL = new Set(["mise.local.toml"]);

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** The Explorer nesting groups: each anchor file and the patterns nested under it. */
function nestingGroups(): Map<string, string[]> {
  const json = read(".vscode/settings.json")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const settings = JSON.parse(json) as Record<string, unknown>;
  const patterns = settings["explorer.fileNesting.patterns"] as Record<
    string,
    string
  >;
  return new Map(
    Object.entries(patterns).map(([anchor, children]) => [
      anchor,
      children.split(",").map((child) => child.trim()),
    ]),
  );
}

/** The root `.gitignore` patterns that name a file at any depth, such as `*.vsix` or `.DS_Store`. */
function ignoredNames(): string[] {
  return read(".gitignore")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"),
    )
    .map((line) => line.replace(/^\//, ""))
    .filter((line) => !line.includes("/") || line.endsWith("/"));
}

/** The root entries that are files, or symlinks to files, and that `.gitignore` does not exclude. */
function rootFiles(): string[] {
  const ignored = ignoredNames();
  return readdirSync(ROOT).filter(
    (name) =>
      // A secondary workspace's .git is a file.
      name !== ".git" &&
      statSync(join(ROOT, name)).isFile() &&
      !ignored.some((pattern) => matchesGlob(name, pattern.replace(/\/$/, ""))),
  );
}

/** The root entries that are directories and that `.gitignore` does not exclude. */
function rootDirectories(): string[] {
  const ignored = ignoredNames().map((pattern) => pattern.replace(/\/$/, ""));
  return readdirSync(ROOT).filter(
    (name) =>
      statSync(join(ROOT, name)).isDirectory() &&
      ![".git", ".jj"].includes(name) &&
      !ignored.some((pattern) => matchesGlob(name, pattern)),
  );
}

/** Returns each name in `files` that is neither an anchor nor matched by a group's pattern. */
function ungrouped(files: string[], groups: Map<string, string[]>): string[] {
  const patterns = [...groups.values()].flat();
  return files.filter(
    (name) =>
      !groups.has(name) &&
      !patterns.some((pattern) => matchesGlob(name, pattern)),
  );
}

describe("ungrouped", () => {
  it("accepts anchors and nested names and reports the rest", () => {
    const groups = new Map([[".tools", ["tsconfig*.json", "justfile"]]]);
    expect(
      ungrouped([".tools", "tsconfig.json", "justfile", "stray.json"], groups),
    ).toEqual(["stray.json"]);
  });
});

describe("root layout", () => {
  const groups = nestingGroups();

  it("puts every root file in an Explorer nesting group", () => {
    expect(ungrouped(rootFiles(), groups)).toEqual([]);
  });

  it("has only the recorded top-level directories", () => {
    expect(
      rootDirectories().filter((name) => !ROOT_DIRECTORIES.has(name)),
    ).toEqual([]);
  });

  it("lists only names that exist", () => {
    const missing = [...groups.entries()].flatMap(([anchor, children]) =>
      [anchor, ...children]
        .filter((name) => !name.includes("*") && !OPTIONAL.has(name))
        .filter((name) => !existsSync(join(ROOT, name)))
        .map((name) => `${anchor}: ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
