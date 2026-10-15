#!/usr/bin/env node
// Usage: node scripts/quality/deprecation-trace.mjs
// Runs the build, lint, test and package steps with --trace-deprecation and fails on any warning ALLOWED does not list.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

/** Deprecations the trace run accepts. Unit tests throw on every code, so no entry here reaches them. */
export const ALLOWED = {
  DEP0169: {
    packages: ["typed-rest-client", "azure-devops-node-api"],
    via: "@vscode/vsce",
    unblock:
      "a @vscode/vsce release whose dependencies no longer call url.parse()",
  },
};

const HEADER = /^\(node:\d+\) \[(DEP\d{4})\] (.*)$/;
const FRAME = /^\s+at /;
const PACKAGE_FRAME = /node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g;
const NODE_INTERNAL = /\(node:|at node:/;

/** Returns `{ code, message, stack }` for each `[DEPxxxx]` warning block in `stderr`, with its stack lines. */
export function parseDeprecations(stderr) {
  const found = [];
  let current = null;
  for (const line of stderr.split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      current = { code: header[1], message: header[2], stack: "" };
      found.push(current);
    } else if (current && FRAME.test(line)) {
      current.stack += `${line}\n`;
    } else {
      current = null;
    }
  }
  return found.map((entry) => ({ ...entry, stack: entry.stack.trimEnd() }));
}

/**
 * Returns the package whose code called the deprecated API: the first stack frame that is not Node's own, read
 * for its `node_modules` package, or "(repository)". For nested installs the innermost package wins.
 */
export function attribute(stack) {
  const caller = stack.split("\n").find((frame) => !NODE_INTERNAL.test(frame));
  const names = [...(caller ?? "").matchAll(PACKAGE_FRAME)];
  return names.length > 0 ? names.at(-1)[1] : "(repository)";
}

const STEPS = [
  ["npm run compile", "npm", ["run", "compile"]],
  ["just build", "just", ["build"]],
  ["just lint", "just", ["lint"]],
  ["just test", "just", ["test"]],
  ["just package", "just", ["package"]],
];

function runStep(command, args, run) {
  const env = {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--trace-deprecation"]
      .filter(Boolean)
      .join(" "),
    TRACE_DEPRECATIONS: "1",
  };
  return run(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Runs each step and returns the exit code. A step that cannot be spawned (ENOENT, for example) sets `error`
 * and leaves stdout and stderr unset, so it fails here rather than while reading them.
 * @typedef {object} SpawnResult
 * @property {Error} [error]
 * @property {number | null} [status]
 * @property {string | null} [stdout]
 * @property {string | null} [stderr]
 * @param {(command: string, args: string[], options: object) => SpawnResult} [run]
 */
export function main(run = spawnSync) {
  const seen = new Map();
  for (const [label, command, args] of STEPS) {
    const result = runStep(command, args, run);
    if (result.error) {
      console.error(`${label} failed to start: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      console.error(`${label} failed with exit ${result.status}`);
      console.error((result.stderr ?? "").slice(-4000));
      return 1;
    }
    for (const { code, stack } of parseDeprecations(result.stderr)) {
      const pkg = attribute(stack);
      const key = `${code} ${pkg}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  let exitCode = 0;
  for (const [key, count] of [...seen].sort()) {
    const [code, pkg] = key.split(" ");
    const entry = ALLOWED[code];
    if (entry?.packages.includes(pkg)) {
      console.log(`${key} x${count}: allowed via ${entry.via}`);
    } else {
      console.log(`${key} x${count}: NOT ALLOWED`);
      exitCode = 1;
    }
  }
  if (seen.size === 0) {
    console.log("no deprecation warnings");
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
