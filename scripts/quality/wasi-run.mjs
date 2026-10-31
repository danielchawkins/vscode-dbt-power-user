#!/usr/bin/env node
// The runner for `cargo test --target wasm32-wasip1`, set in crates/.cargo/config.toml. It runs the test binary under
// Node's own WASI (node:wasi, preview 1), so no separate runtime is installed: the repository already pins Node.
// The process environment is passed through. When GRAPH_LAYOUT_SOLVE_OUT, GRAPH_LAYOUT_LAYERING_OUT,
// GRAPH_LAYOUT_LAYERING_TIMING, GRAPH_LAYOUT_ORDER_OUT, GRAPH_LAYOUT_ORDER_TIMING, GRAPH_LAYOUT_PLACE_OUT,
// GRAPH_LAYOUT_PLACE_FINANCE_OUT or GRAPH_LAYOUT_PLACE_TIMING names a file, its directory is preopened at the same path,
// so the test can write the output files or read the timing workload. Contributor tooling only; it ships nothing.
//
//   node scripts/quality/wasi-run.mjs <test.wasm> [test arguments...]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { WASI } from "node:wasi";

const [binary, ...args] = process.argv.slice(2);
if (binary === undefined) {
  process.stderr.write("usage: wasi-run.mjs <test.wasm> [arguments...]\n");
  process.exit(2);
}

const preopens = {};
for (const name of [
  "GRAPH_LAYOUT_SOLVE_OUT",
  "GRAPH_LAYOUT_LAYERING_OUT",
  "GRAPH_LAYOUT_LAYERING_TIMING",
  "GRAPH_LAYOUT_ORDER_OUT",
  "GRAPH_LAYOUT_ORDER_TIMING",
  "GRAPH_LAYOUT_PLACE_OUT",
  "GRAPH_LAYOUT_PLACE_FINANCE_OUT",
  "GRAPH_LAYOUT_PLACE_TIMING",
]) {
  const output = process.env[name];
  if (output !== undefined) {
    const directory = path.dirname(path.resolve(output));
    preopens[directory] = directory;
  }
}

const wasi = new WASI({
  version: "preview1",
  args: [binary, ...args],
  env: process.env,
  preopens,
});
const module = await WebAssembly.compile(await readFile(binary));
const instance = await WebAssembly.instantiate(module, {
  wasi_snapshot_preview1: wasi.wasiImport,
});

try {
  process.exitCode = wasi.start(instance);
} catch (error) {
  // A panic in the test traps inside the module; report it as a failed test run, not as a crash of this runner.
  process.stderr.write(`wasi-run: ${error?.message ?? error}\n`);
  process.exitCode = 1;
}
