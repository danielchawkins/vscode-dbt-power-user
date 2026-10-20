#!/usr/bin/env node
// Usage: node scripts/smoke/failure-summary.mjs <diagnostics-dir>
// Prints a Markdown table of every failure bundle under <diagnostics-dir>: the test, the wait that failed and the
// last value it read. CI appends it to $GITHUB_STEP_SUMMARY, so a failed run names its failures on the PR.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || !existsSync(root)) {
  process.exit(0);
}

function bundles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    if (!statSync(entry).isDirectory()) {
      return [];
    }
    return existsSync(path.join(entry, "error.json"))
      ? [entry]
      : bundles(entry);
  });
}

const cell = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .slice(0, 300);

const rows = bundles(root).map((dir) => {
  const error = JSON.parse(readFileSync(path.join(dir, "error.json"), "utf-8"));
  return `| ${cell(error.title)} | ${cell(error.lastProbe?.label)} | ${cell(JSON.stringify(error.lastProbe?.value))} | ${cell(path.relative(root, dir))} |`;
});
if (rows.length > 0) {
  console.log("### Smoke failures\n");
  console.log("| Test | Last wait | Last value | Bundle |");
  console.log("| --- | --- | --- | --- |");
  console.log(rows.join("\n"));
}
