#!/usr/bin/env node
// Usage: node scripts/quality/vsix-contents.mjs [vsix]   fail when the VSIX holds an entry outside the shipped surface
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

/** The entries vsce writes for every extension, whatever the manifest says. */
const FIXED = new Set([
  "extension.vsixmanifest",
  "[Content_Types].xml",
  "extension/package.json",
  "extension/readme.md",
  "extension/LICENSE.txt",
]);

/** The directories the extension reads at run time; everything else is contributor tooling. */
const SHIPPED = [
  "extension/dist/",
  "extension/media/",
  "extension/syntaxes/",
  "extension/snippets/",
];

/**
 * Whether `entry` is a file the extension loads: under a shipped directory and not a source map or a Node-API binding.
 * The host loads the WebAssembly engine from dist/graph-layout/; the `.node` binding is for contributor tooling only.
 */
const shippedFile = (entry, shipped) =>
  !entry.endsWith(".map") &&
  !entry.endsWith(".node") &&
  shipped.some((dir) => entry.startsWith(dir));

/** Returns each entry that is neither a fixed vsce entry nor a shipped file. */
export function unexpectedEntries(entries, shipped = SHIPPED) {
  return entries.filter(
    (entry) =>
      entry !== "" &&
      !entry.endsWith("/") &&
      !FIXED.has(entry) &&
      !shippedFile(entry, shipped),
  );
}

/** Returns each fixed vsce entry that `entries` lacks; a missing LICENSE.txt means `files` dropped LICENSE. */
export function missingEntries(entries) {
  const present = new Set(entries);
  return [...FIXED].filter((entry) => !present.has(entry));
}

function main() {
  const vsix =
    process.argv[2] ??
    fs.readFileSync(path.join(root, "out/latest-vsix"), "utf8").trim();
  const entries = execFileSync("unzip", ["-Z1", vsix], {
    encoding: "utf8",
  }).split("\n");
  const problems = [
    ...unexpectedEntries(entries).map((entry) => `unexpected entry ${entry}`),
    ...missingEntries(entries).map((entry) => `missing entry ${entry}`),
  ];
  for (const problem of problems) {
    console.error(`${vsix}: ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
