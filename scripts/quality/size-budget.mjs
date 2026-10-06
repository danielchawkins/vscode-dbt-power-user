#!/usr/bin/env node
// Usage: node scripts/quality/size-budget.mjs   fail when a built artifact exceeds its `size` budget in ceilings.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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

function measure(budgets) {
  const assets = "webview_panels/dist/assets";
  const sizes = {};
  for (const key of Object.keys(budgets)) {
    if (key === "vsix") {
      const vsix = fs.readFileSync(path.join(root, "out/latest-vsix"), "utf8");
      sizes[key] = fs.statSync(vsix.trim()).size;
    } else if (key === "wasm") {
      sizes[key] = fs
        .readdirSync(path.join(root, assets))
        .filter((name) => name.endsWith(".wasm"))
        .reduce((total, name) => total + sizeOf(`${assets}/${name}`), 0);
    } else if (fs.existsSync(path.join(root, key))) {
      sizes[key] = sizeOf(key);
    }
  }
  return sizes;
}

function main() {
  const { size } = JSON.parse(
    fs.readFileSync(path.join(root, "scripts/quality/ceilings.json"), "utf8"),
  );
  const problems = overBudget(size, measure(size));
  for (const problem of problems) {
    console.error(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
