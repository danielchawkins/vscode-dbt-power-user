#!/usr/bin/env node
// Usage: node scripts/quality/strict-ts.mjs [host|webview]
// Prints the number of noUncheckedIndexedAccess and exactOptionalPropertyTypes errors in production files.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tsc = path.join(root, "node_modules/typescript/bin/tsc");

/** Each project's directory and the `tsconfig.strict.json` it is checked with. */
export const STRICT_PROJECTS = {
  host: "",
  webview: "webview_panels",
};

const isProductionFile = (file) =>
  file.startsWith("src/") &&
  !file.startsWith("src/test/") &&
  !/\.test\.tsx?$/.test(file);

/** Counts the strict-mode errors `tsc` reports in production files; `output` is tsc's stdout. */
export function countProductionErrors(output) {
  let count = 0;
  for (const match of output.matchAll(
    /^(\S[^(\n]*)\(\d+,\d+\): error TS\d+/gm,
  )) {
    if (isProductionFile(match[1])) {
      count += 1;
    }
  }
  return count;
}

/** Rebuilds the webview contract from scratch; the webview resolves its types from `dist`. */
function rebuildContract() {
  const dir = path.join(root, "packages/webview-contract");
  fs.rmSync(path.join(dir, "dist"), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [tsc, "-b"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`contract build failed:\n${result.stdout}${result.stderr}`);
  }
}

/** Runs the strict check for `project` and returns its production error count. */
export function strictErrors(project) {
  const cwd = path.join(root, STRICT_PROJECTS[project]);
  if (project === "webview") {
    rebuildContract();
  }
  // A stale build info survives revision switches and skews the count.
  fs.rmSync(path.join(cwd, "out/tsconfig.strict.tsbuildinfo"), { force: true });
  const result = spawnSync(
    process.execPath,
    [tsc, "-p", "tsconfig.strict.json", "--noEmit", "--pretty", "false"],
    {
      cwd,
      encoding: "utf8",
    },
  );
  if (result.status !== 0 && !/error TS\d+/.test(result.stdout)) {
    throw new Error(`tsc failed in ${cwd}:\n${result.stdout}${result.stderr}`);
  }
  return countProductionErrors(result.stdout);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const project of process.argv.length > 2
    ? process.argv.slice(2)
    : Object.keys(STRICT_PROJECTS)) {
    console.log(`${project} ${strictErrors(project)}`);
  }
}
