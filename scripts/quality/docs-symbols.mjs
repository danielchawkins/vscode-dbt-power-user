#!/usr/bin/env node
// Usage: node scripts/quality/docs-symbols.mjs
// Fails when a backticked identifier or repository path in the design documents does not exist in the code.
// Names that are legitimately absent (external APIs, removed code) go in docs-symbols-allow.txt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PATH_ROOTS = ["src/", "webview_panels/", "packages/", "scripts/"];
const SOURCE_DIRS = [
  "src",
  "webview_panels/src",
  ...fs
    .readdirSync(path.join(root, "packages"))
    .map((name) => `packages/${name}/src`),
  "scripts",
];

/** Backticked spans of `text`, as `{ span, line }`. */
export function spans(text) {
  const found = [];
  const lines = text.split("\n");
  let fenced = false;
  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      fenced = !fenced;
    } else if (!fenced) {
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        found.push({ span: match[1], line: index + 1 });
      }
    }
  });
  return found;
}

/** The checkable claim in a span: a repository path, an identifier, or nothing. */
export function claim(span) {
  const token = span.trim().replace(/[:#]\d+(-\d+)?$/, "");
  if (PATH_ROOTS.some((prefix) => token.startsWith(prefix))) {
    return /^[\w./@-]+$/.test(token) && !token.includes("*")
      ? { kind: "path", value: token.replace(/\/$/, "") }
      : undefined;
  }
  const identifier = /^(?:[A-Za-z]\w*\.)*([A-Za-z]\w*)(?:\(\))?$/.exec(token);
  if (identifier === null) {
    return undefined;
  }
  const name = identifier[1];
  return /^[A-Z][a-z0-9]+[A-Za-z0-9]*[A-Z]|^[a-z]+[a-z0-9]*[A-Z]/.test(name)
    ? { kind: "symbol", value: name }
    : undefined;
}

const walk = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .filter((entry) => !entry.parentPath.includes("node_modules"))
        .map((entry) => path.join(entry.parentPath, entry.name))
    : [];

export function findMissing(docs, corpus, exists, allow) {
  const missing = [];
  for (const { file, text } of docs) {
    for (const { span, line } of spans(text)) {
      const c = claim(span);
      if (c === undefined || allow.has(c.value)) {
        continue;
      }
      const present =
        c.kind === "path" ? exists(c.value) : corpus.includes(c.value);
      if (!present) {
        missing.push(`${file}:${line}: \`${span}\``);
      }
    }
  }
  return missing;
}

function main() {
  const allow = new Set(
    fs
      .readFileSync(
        path.join(root, "scripts/quality/docs-symbols-allow.txt"),
        "utf8",
      )
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
  const docFiles = [
    "AGENTS.md",
    "CONTEXT.md",
    "docs/architecture.md",
    ...walk(path.join(root, "docs/adr"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => path.relative(root, file)),
  ];
  const docs = docFiles.map((file) => ({
    file,
    text: fs.readFileSync(path.join(root, file), "utf8"),
  }));
  const corpus =
    SOURCE_DIRS.flatMap((dir) => walk(path.join(root, dir)))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n") + fs.readFileSync(path.join(root, "package.json"), "utf8");
  const missing = findMissing(
    docs,
    corpus,
    (p) => fs.existsSync(path.join(root, p)),
    allow,
  );
  for (const entry of missing) {
    console.error(`not found in the code: ${entry}`);
  }
  return missing.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
