#!/usr/bin/env node
// Compares the solver's native and WebAssembly outputs for the random problems, byte for byte. Each file holds one line
// per seed: `seed<TAB>bits,bits,...`, where each value is the 16-hex-digit IEEE bit pattern of the coordinate.
// `just crates::solve-parity` writes both files and runs this; a bit that differs anywhere fails the recipe.
//
//   node scripts/parity/compare-solve.mjs <native.txt> <wasm.txt>
//
// Exit 0: identical. Exit 1: they differ; the report names the seeds. Exit 2: a file is missing or not the expected
// shape, so the comparison did not happen. The planted-divergence recipe relies on that split.

import { readFile } from "node:fs/promises";

const PROBLEMS = 2000;

const [nativePath, wasmPath] = process.argv.slice(2);
if (nativePath === undefined || wasmPath === undefined) {
  process.stderr.write("usage: compare-solve.mjs <native.txt> <wasm.txt>\n");
  process.exit(2);
}

async function load(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    process.stderr.write(
      `solve-parity: cannot read ${path}: ${error.message}\n`,
    );
    process.exit(2);
  }
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines.length !== PROBLEMS) {
    process.stderr.write(
      `solve-parity: ${path} has ${lines.length} lines; expected ${PROBLEMS} newline-ended lines\n`,
    );
    process.exit(2);
  }
  return lines;
}

const native = await load(nativePath);
const wasm = await load(wasmPath);

const differing = [];
for (let seed = 0; seed < PROBLEMS; seed++) {
  if (native[seed] !== wasm[seed]) {
    differing.push(seed);
  }
}

if (differing.length === 0) {
  console.log(
    `solve-parity: native and wasm outputs are byte-identical on ${PROBLEMS} of ${PROBLEMS} problems`,
  );
  process.exit(0);
}

console.log(
  `solve-parity: ${differing.length} of ${PROBLEMS} outputs differ; first seeds: ${differing.slice(0, 5).join(", ")}`,
);
for (const seed of differing.slice(0, 3)) {
  console.log(`  native seed ${seed}: ${native[seed]}`);
  console.log(`  wasm   seed ${seed}: ${wasm[seed]}`);
}
process.exit(1);
