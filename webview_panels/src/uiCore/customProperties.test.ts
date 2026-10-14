import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(import.meta.dirname, "..");
const lineage = join(src, "modules", "lineage");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === lineage ? [] : sources(path);
    return /\.(css|tsx?)$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });

describe("webview custom properties", () => {
  const files = sources(src).map((path) => ({
    path: relative(src, path),
    text: readFileSync(path, "utf8"),
  }));
  const defined = new Set(
    files.flatMap(({ text }) =>
      Array.from(text.matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]),
    ),
  );

  it("reads only --vscode-* tokens or tokens a loaded stylesheet defines", () => {
    const undefinedUses = files.flatMap(({ path, text }) =>
      Array.from(text.matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1])
        .filter((name) => !name.startsWith("--vscode-") && !defined.has(name))
        .map((name) => `${path}: ${name}`),
    );
    expect(undefinedUses).toEqual([]);
  });

  it("closes every var() inside an inline style string", () => {
    const unclosed = files.flatMap(({ path, text }) =>
      Array.from(
        text.matchAll(/var\(--[\w-]+["'`]/g),
        (m) => `${path}: ${m[0]}`,
      ),
    );
    expect(unclosed).toEqual([]);
  });
});
