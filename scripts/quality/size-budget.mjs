#!/usr/bin/env node
// Usage: node scripts/quality/size-budget.mjs [--crates]   fail when a built artifact exceeds its `size` budget in ceilings.json
// Without a flag it checks the package keys; `--crates` checks the `dist/graph-layout/` keys that `crates::wasm` builds.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

/** Returns one message per budget that `sizes` exceeds or lacks. */
export function overBudget(budgets, sizes) {
  const problems = [];
  for (const [key, budget] of Object.entries(budgets)) {
    const size = sizes[key];
    if (size === undefined) {
      problems.push(`${key}: not built`);
    } else if (size > budget) {
      problems.push(`${key}: ${size} bytes, over the budget of ${budget}`);
    }
  }
  return problems;
}

const sizeOf = (file) => fs.statSync(path.join(root, file)).size;

// The keys under this prefix are built by `crates::wasm`, not by `just package`, so each path checks its own group.
const CRATES_PREFIX = "dist/graph-layout/";

function measure(budgets) {
  const assets = "dist/webview/assets";
  const sizes = {};
  for (const key of Object.keys(budgets)) {
    if (key === "vsix") {
      const vsix = fs.readFileSync(path.join(root, "out/latest-vsix"), "utf8");
      sizes[key] = fs.statSync(vsix.trim()).size;
    } else if (fs.existsSync(path.join(root, key))) {
      sizes[key] = sizeOf(key);
    }
  }
  return sizes;
}

function main(args) {
  const { size } = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/quality/ceilings.json"), "utf8"),
  );
  const crates = args.includes("--crates");
  const budgets = Object.fromEntries(
    Object.entries(size).filter(
      ([key]) => key.startsWith(CRATES_PREFIX) === crates,
    ),
  );
  const problems = overBudget(budgets, measure(budgets));
  for (const problem of problems) {
    console.error(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
