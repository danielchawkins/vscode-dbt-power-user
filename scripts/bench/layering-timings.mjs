#!/usr/bin/env node
// Times ranking and layering (`rank` then `layer` in TypeScript, `rank_and_layer` in the Rust core) on two graphs, in
// milliseconds per pass: the finance lineage graph (built from a dbt manifest by the same path as the parity export,
// print-fixtures.mjs layering-finance) and a seeded 3,000-node synthetic DAG (syntheticDag). The Rust core reads no
// clock (ADR 0011), so each Rust run is a whole test process (`layering_timing_workload_runs`, native release, and
// wasm32-wasip1 release through Node's WASI) timed from outside at two repeat counts; the time per pass is the slope
// between them, which cancels process start-up and the parse of the case. TypeScript runs in process with its own two
// repeat counts. Each Rust case is written from the TypeScript run, and the Rust test checks its first run against that
// output, so the timed runs are the same computation. Every figure is the median of three runs.
//
//   node scripts/bench/layering-timings.mjs [manifest.json]

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
// Repeat counts for each workload, two per runtime, so the slope spans a few seconds. TypeScript runs a pass in about
// 80 ms on the finance graph and 2.4 s on the synthetic DAG; Rust runs a pass in about 19 ms and 0.8 s.
const TYPESCRIPT_REPEATS = { finance: [10, 60], synthetic: [2, 10] };
const RUST_REPEATS = { finance: [10, 110], synthetic: [1, 11] };

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

// The slope of the wall time between the two repeat counts, per pass, for one Rust target.
function rustPerPass(target, casePath, repeats) {
  const base = [
    "test",
    "--release",
    "--locked",
    "-p",
    "graph-layout",
    "layering_timing_workload_runs",
  ];
  const extra = target === "wasm" ? ["--target", "wasm32-wasip1"] : [];
  const times = repeats.map((k) =>
    median(
      Array.from({ length: RUNS }, () =>
        cargo([...base, ...extra], {
          GRAPH_LAYOUT_LAYERING_TIMING: casePath,
          GRAPH_LAYOUT_LAYERING_REPEATS: String(k),
        }),
      ),
    ),
  );
  return (times[1] - times[0]) / (repeats[1] - repeats[0]);
}

// The TypeScript resolve hook is registered before the sources load, as in the other parity and bench scripts.
register(pathToFileURL(join(root, "scripts/parity/ts-resolve.mjs")));
const { rank } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/rank/index.ts")).href
);
const { layer } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/layering.ts")).href
);
const { seededRandom } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/random.ts")).href
);
const { financeGraph } = await import("../parity/finance-graph.mjs");
const { layeringLine, LINEAGE_OPTIONS, portedScope, syntheticDag } =
  await import("../parity/layering-graphs.mjs");

const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// Times one workload: the TypeScript pass and the two Rust targets, each on the same graph and options.
function timeWorkload(name, graph) {
  const scope = portedScope(graph);
  const typescriptPass = () =>
    layer(scope, LINEAGE_OPTIONS, rank(scope, LINEAGE_OPTIONS));
  const dir = mkdtempSync(join(tmpdir(), "layering-timings-"));
  try {
    const casePath = join(dir, `${name}.txt`);
    const line = layeringLine(name, graph, {
      options: LINEAGE_OPTIONS,
      rank,
      layer,
    });
    writeFileSync(casePath, `${line}\n`);
    const repeats = TYPESCRIPT_REPEATS[name];
    typescriptPass();
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
    return {
      name,
      nodes: scope.nodes.length,
      edges: scope.edges.length,
      ts: (times[1] - times[0]) / (repeats[1] - repeats[0]),
      native: rustPerPass("native", casePath, RUST_REPEATS[name]),
      wasm: rustPerPass("wasm", casePath, RUST_REPEATS[name]),
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

const rows = [
  timeWorkload("finance", financeGraph(manifest)),
  timeWorkload(
    "synthetic",
    syntheticDag(SYNTHETIC_NODES, seededRandom(SYNTHETIC_SEED)),
  ),
];

const f = (x) => x.toFixed(3).padStart(9);
console.log(
  `node ${process.version}; per pass (rank and layer) in ms; margin = TypeScript / Rust`,
);
console.log(
  "workload".padEnd(36) +
    "TypeScript".padStart(11) +
    "Rust native".padStart(13) +
    "Rust WASI".padStart(11) +
    "  native x  WASI x",
);
for (const r of rows) {
  const label = `${r.name} (${r.nodes} nodes, ${r.edges} edges)`;
  console.log(
    label.padEnd(36) +
      f(r.ts).padStart(11) +
      f(r.native).padStart(13) +
      f(r.wasm).padStart(11) +
      `  ${(r.ts / r.native).toFixed(2).padStart(8)}  ${(r.ts / r.wasm).toFixed(2).padStart(8)}`,
  );
}
