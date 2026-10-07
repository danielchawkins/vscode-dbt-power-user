// Stand-in for `fast-glob` in `type-coverage-core`, wired through `overrides` in the root package.json.
// fast-glob 3 depends on micromatch 4 and braces 3, whose latest release carries an unpatched denial-of-service advisory.
// type-coverage-core calls `fg(patterns, { ignore, cwd })` once, to expand tsconfig `include` entries into files.
"use strict";
const { glob } = require("node:fs/promises");
const path = require("node:path");

module.exports = async function fg(
  patterns,
  { ignore = [], cwd = process.cwd() } = {},
) {
  const found = [];
  const entries = glob(patterns, { cwd, exclude: ignore, withFileTypes: true });
  for await (const entry of entries) {
    if (entry.isFile()) {
      found.push(path.join(entry.parentPath, entry.name));
    }
  }
  return found;
};
