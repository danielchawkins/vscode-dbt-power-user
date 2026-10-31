#!/usr/bin/env node
// Times ordering (`order`, on a layered graph that is already ranked and layered) in TypeScript, Rust native and Rust
// under WASI, in milliseconds per pass: the finance lineage graph (built from a dbt manifest by the same path as the
// parity export, print-fixtures.mjs order-finance) and a seeded 3,000-node synthetic DAG (syntheticDag). The Rust core
// reads no clock (ADR 0011), so each Rust run is a whole test process (`order_timing_workload_runs`, native release,
// and wasm32-wasip1 release through Node's WASI) timed from outside at two repeat counts; the time per pass is the slope
// between them, which cancels process start-up and the parse of the case. TypeScript runs in process with its own two
// repeat counts. Each Rust case is written from the TypeScript run, and the Rust test checks its first order against
// TypeScript's crossings, so the timed runs are the same computation. Every figure is the median of three runs.
//
// The synthetic DAG at `thorough` takes about 80 s a pass in TypeScript, so it is not timed; the table says so.
//
//   node scripts/bench/order-timings.mjs [manifest.json]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const crates = join(root, "crates");
const RUNS = 3;
const SYNTHETIC_NODES = 3000;
const SYNTHETIC_SEED = 1;
const DEFAULT_MANIFEST =
  "/Users/daniel/projects/finance-pipelines/conformance-staging/transformation/dbt/finance_general/target/manifest.json";
// Repeat counts for each workload and effort, two per runtime, so the slope spans a few seconds. TypeScript's pass
// times are in the comments; Rust's are measured by the first run of this script and kept in the discrepancy report.
const EFFORTS = {
  finance: ["fast", "balanced", "thorough"],
  synthetic: ["fast", "balanced"],
};
const TYPESCRIPT_REPEATS = {
  finance: { fast: [4, 14], balanced: [2, 8], thorough: [1, 3] },
  synthetic: { fast: [1, 3], balanced: [1, 3] },
};
const RUST_REPEATS = {
  finance: { fast: [10, 110], balanced: [10, 110], thorough: [5, 25] },
  synthetic: { fast: [5, 25], balanced: [5, 25] },
};

const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];

// Runs cargo in the crates workspace and returns its wall time and its standard output.
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
  return { ms, stdout: run.stdout };
}

// The Rust crossings the timed test printed, which the first run must match the TypeScript bound for. Not anchored to
// a line: under WASI the test harness writes its `test ... ` prefix before the line, on the same line.
const CROSSINGS = /order-timing: crossings (\S+)/;

// The slope of the wall time between the two repeat counts, per pass, for one Rust target, and the crossings it
// reports.
function rustPerPass(target, { casePath, effort }, repeats) {
  const targetArgs = target === "wasm" ? ["--target", "wasm32-wasip1"] : [];
  let crossings;
  const times = repeats.map((k) =>
    median(
      Array.from({ length: RUNS }, () => {
        const run = cargo(
          [
            "test",
            "--release",
            "--locked",
            "-p",
            "graph-layout",
            ...targetArgs,
            "order_timing_workload_runs",
            "--",
            "--nocapture",
          ],
          {
            GRAPH_LAYOUT_ORDER_TIMING: casePath,
            GRAPH_LAYOUT_ORDER_EFFORT: effort,
            GRAPH_LAYOUT_ORDER_REPEATS: String(k),
          },
        );
        const match = CROSSINGS.exec(run.stdout);
        if (match === null) {
          throw new Error(
            `${target} at ${effort}: the timed test printed no crossings\n${run.stdout}`,
          );
        }
        crossings = Number(match[1]);
        return run.ms;
      }),
    ),
  );
  return {
    perPass: (times[1] - times[0]) / (repeats[1] - repeats[0]),
    crossings,
  };
}

// The TypeScript resolve hook is registered before the sources load, as in the other parity and bench scripts.
register(pathToFileURL(join(root, "scripts/parity/ts-resolve.mjs")));
const { rank } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/rank/index.ts")).href
);
const { layer } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/layering.ts")).href
);
const { order } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/order/index.ts")).href
);
const { seededRandom } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/random.ts")).href
);
const { financeGraph } = await import("../parity/finance-graph.mjs");
const { caseLine } = await import("../parity/order-fixtures.mjs");
const { LINEAGE_OPTIONS, portedScope, syntheticDag } =
  await import("../parity/layering-graphs.mjs");

const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Times one workload at one effort: the TypeScript pass, the two Rust targets, each on the same layered graph.
function timeWorkload(name, graph, effort) {
  const scope = portedScope(graph);
  const base = { ...LINEAGE_OPTIONS, effort };
  const ranking = rank(scope, base);
  const layered = layer(scope, base, ranking);
  const typescriptPass = () =>
    order(scope, { ...base, seed: 0 }, { ...ranking, layered });
  const dir = mkdtempSync(join(tmpdir(), "order-timings-"));
  try {
    const casePath = join(dir, `${name}-${effort}.txt`);
    const line = caseLine(
      {
        name,
        seed: 0,
        graph,
        options: LINEAGE_OPTIONS,
        efforts: [effort],
        hintSettings: [false],
      },
      { rank, layer },
    );
    writeFileSync(casePath, `${line}\n`);
    const repeats = TYPESCRIPT_REPEATS[name][effort];
    const tsCrossings = typescriptPass().crossings;
    const times = repeats.map((k) =>
      median(
        Array.from({ length: RUNS }, () => {
          const started = performance.now();
          for (let i = 0; i < k; i++) {
            typescriptPass();
          }
          return performance.now() - started;
        }),
      ),
    );
    const workload = { casePath, effort };
    const repeatsRust = RUST_REPEATS[name][effort];
    const native = rustPerPass("native", workload, repeatsRust);
    const wasm = rustPerPass("wasm", workload, repeatsRust);
    return {
      name,
      effort,
      nodes: scope.nodes.length,
      edges: scope.edges.length,
      ts: (times[1] - times[0]) / (repeats[1] - repeats[0]),
      tsCrossings,
      native: native.perPass,
      nativeCrossings: native.crossings,
      wasm: wasm.perPass,
      wasmCrossings: wasm.crossings,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

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

const graphs = {
  finance: () => financeGraph(manifest),
  synthetic: () => syntheticDag(SYNTHETIC_NODES, seededRandom(SYNTHETIC_SEED)),
};
const rows = [];
for (const name of Object.keys(EFFORTS)) {
  const graph = graphs[name]();
  for (const effort of EFFORTS[name]) {
    rows.push(timeWorkload(name, graph, effort));
  }
}

const f = (x) => x.toFixed(3).padStart(10);
console.log(
  `node ${process.version}; order only, per pass in ms; margin = TypeScript / Rust`,
);
console.log(
  "workload".padEnd(40) +
    "TypeScript".padStart(11) +
    "Rust native".padStart(13) +
    "Rust WASI".padStart(11) +
    "  native x  WASI x" +
    "   crossings TS / native / WASI",
);
for (const r of rows) {
  const label = `${r.name} ${r.effort} (${r.nodes} nodes, ${r.edges} edges)`;
  console.log(
    label.padEnd(40) +
      f(r.ts).padStart(11) +
      f(r.native).padStart(13) +
      f(r.wasm).padStart(11) +
      `  ${(r.ts / r.native).toFixed(2).padStart(8)}  ${(r.ts / r.wasm).toFixed(2).padStart(8)}` +
      `   ${r.tsCrossings} / ${r.nativeCrossings} / ${r.wasmCrossings}`,
  );
}
