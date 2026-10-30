#!/usr/bin/env node
// Times the VPSC solver (`solveSeparations` in TypeScript, `solve` in the Rust core) on the 2,000 random problems and on
// the quadratic merging chains of n = 128 to 1,024 (the workload of scripts/spikes/graph-layout/vpsc-spike.mjs), in
// milliseconds per solve. The Rust core reads no clock (ADR 0011), so each Rust run is a whole test process
// (`timing_workload_runs`, native release, and wasm32-wasip1 release through Node's WASI) timed from outside at two
// repeat counts; the time per solve is the slope between them, which cancels process start-up. TypeScript runs in
// process with the same repeat counts. Every figure is the median of three runs.
//
//   node scripts/bench/solve-timings.mjs

import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const crates = join(root, "crates");
const RUNS = 3;
const RANDOM_PROBLEMS = 2000;
// Repeat counts for each workload: solve counts, two per workload, so the slope spans about a second.
const RANDOM_REPEATS = [100, 400];
const CHAIN_REPEATS = [100, 1100];

const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];

function cargo(args, env = {}) {
  const started = performance.now();
  const run = spawnSync("cargo", args, {
    cwd: crates,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const ms = performance.now() - started;
  if (run.status !== 0) {
    throw new Error(
      `cargo ${args.join(" ")} exited ${run.status}\n${run.stdout}${run.stderr}`,
    );
  }
  return ms;
}

// The slope of the wall time between the two repeat counts, per solve, for one Rust target.
function rustPerSolve(target, workload, repeats) {
  const base = [
    "test",
    "--release",
    "--locked",
    "-p",
    "graph-layout",
    "timing_workload_runs",
  ];
  const extra = target === "wasm" ? ["--target", "wasm32-wasip1"] : [];
  const times = repeats.map((k) =>
    median(
      Array.from({ length: RUNS }, () =>
        cargo([...base, ...extra], {
          GRAPH_LAYOUT_SOLVE_WORKLOAD: workload,
          GRAPH_LAYOUT_SOLVE_REPEATS: String(k),
        }),
      ),
    ),
  );
  return (times[1] - times[0]) / (repeats[1] - repeats[0]);
}

// The TypeScript solver, loaded from the sources with the parity tooling's resolve hook.
register(pathToFileURL(join(root, "scripts/parity/ts-resolve.mjs")));
const { solveSeparations } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/solve/vpsc.ts")).href
);
const { seededRandom } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/random.ts")).href
);

// The generator of scripts/parity/print-fixtures.mjs, so the TypeScript and Rust problems are the same.
function randomProblem(seed) {
  const random = seededRandom(seed);
  const n = 2 + Math.floor(random() * 24);
  const integral = seed % 4 === 0;
  const x0 = Array.from({ length: n }, () =>
    integral ? Math.floor(random() * 10) : random() * 100 - 50,
  );
  const weight = Array.from({ length: n }, () => 0.5 + random() * 2);
  const count = Math.floor(random() * (3 * n));
  const seps = [];
  for (let k = 0; k < count; k++) {
    let a = Math.floor(random() * n);
    let b = Math.floor(random() * n);
    if (a === b) {
      continue;
    }
    if (a > b) {
      [a, b] = [b, a];
    }
    const gap = integral ? Math.floor(random() * 5) - 2 : random() * 10 - 2;
    seps.push({ from: a, to: b, gap });
  }
  return { x0, weight, seps };
}

// The merging chain of the spike: separations i -> i+1 with gap 1, unit weights.
function chain(n, reverse) {
  const x0 = Array.from({ length: n }, (_, i) =>
    reverse ? (n - i) * 0.25 : 0,
  );
  return {
    x0,
    weight: Array.from({ length: n }, () => 1),
    seps: Array.from({ length: n - 1 }, (_, i) => ({
      from: i,
      to: i + 1,
      gap: 1,
    })),
  };
}

function typescriptPerSolve(problems, repeats) {
  const pass = () => {
    for (const { x0, weight, seps } of problems) {
      solveSeparations(x0, weight, seps);
    }
  };
  pass();
  const times = repeats.map((k) =>
    median(
      Array.from({ length: RUNS }, () => {
        const started = performance.now();
        for (let i = 0; i < k; i++) {
          pass();
        }
        return performance.now() - started;
      }),
    ),
  );
  return (times[1] - times[0]) / (repeats[1] - repeats[0]);
}

const rows = [];
const randomProblems = Array.from({ length: RANDOM_PROBLEMS }, (_, seed) =>
  randomProblem(seed),
);
// Build both Rust targets once, so the timed runs are the test binaries alone.
cargo(["test", "--release", "--locked", "-p", "graph-layout", "--no-run"]);
cargo([
  "test",
  "--release",
  "--locked",
  "-p",
  "graph-layout",
  "--no-run",
  "--target",
  "wasm32-wasip1",
]);

rows.push({
  name: "random 2,000 (per pass)",
  ts: typescriptPerSolve(randomProblems, RANDOM_REPEATS),
  native: rustPerSolve("native", "random", RANDOM_REPEATS),
  wasm: rustPerSolve("wasm", "random", RANDOM_REPEATS),
});
for (const shape of ["collapse", "reverse"]) {
  for (const n of [128, 256, 512, 1024]) {
    const problem = chain(n, shape === "reverse");
    rows.push({
      name: `chain ${shape} n=${n}`,
      ts: typescriptPerSolve([problem], CHAIN_REPEATS),
      native: rustPerSolve("native", `chain:${shape}:${n}`, CHAIN_REPEATS),
      wasm: rustPerSolve("wasm", `chain:${shape}:${n}`, CHAIN_REPEATS),
    });
  }
}

const f = (x) => x.toFixed(3).padStart(9);
console.log(
  `node ${process.version}; per solve in ms; margin = TypeScript / Rust`,
);
console.log(
  "workload".padEnd(26) +
    "TypeScript".padStart(11) +
    "Rust native".padStart(13) +
    "Rust WASI".padStart(11) +
    "  native x  WASI x",
);
for (const r of rows) {
  console.log(
    r.name.padEnd(26) +
      f(r.ts).padStart(11) +
      f(r.native).padStart(13) +
      f(r.wasm).padStart(11) +
      `  ${(r.ts / r.native).toFixed(2).padStart(8)}  ${(r.ts / r.wasm).toFixed(2).padStart(8)}`,
  );
}
