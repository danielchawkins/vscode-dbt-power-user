#!/usr/bin/env node
// Measures the Rust layout on the finance lineage graph and the seeded 3,000-node synthetic DAG, at fast and balanced,
// natively and under WebAssembly (Node's WASI through scripts/quality/wasi-run.mjs). The graphs are flattened from the
// manifest and from `syntheticDag`'s generator by flatten-graph.mjs, and read by the Rust test `layout_workload_is_measured`
// (crates/graph-layout/src/engine/layout/bench.rs), which lays each out, checks the layout gate and prints its metrics.
// The core reads no clock (ADR 0011), so each Rust run is a whole release test process timed from outside, at two repeat
// counts. The time per pass is the slope between them, which cancels the process start-up, cargo's check and the parse.
// Every cell takes the fastest of three runs at each repeat count: other load on the machine only adds time. The
// metrics line must be the same at both repeat counts, in all three runs and on both targets; the script exits 1 when
// it is not.
//
//   node scripts/bench/layout-timings.mjs [manifest.json]

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { financeGraph, flatten, syntheticGraph } from "./flatten-graph.mjs";

const root = resolve(import.meta.dirname, "../..");
const crates = join(root, "crates");
const DEFAULT_MANIFEST =
  "/Users/daniel/projects/finance-pipelines/conformance-staging/transformation/dbt/finance_general/target/manifest.json";
const RUNS = 3;
const SYNTHETIC_NODES = 3000;
const SYNTHETIC_SEED = 1;
// Repeat counts per workload and effort: the two runs whose wall times give the slope.
const REPEATS = {
  finance: { fast: [2, 62], balanced: [1, 5] },
  synthetic: { fast: [2, 22], balanced: [1, 5] },
};
const TEST = "engine::layout::bench::layout_workload_is_measured";
const LINE = /layout-bench ([^\r\n]*)/;

const fastest = (xs) => Math.min(...xs);

// One whole test process: cargo runs the test in release, for the native or the wasm32-wasip1 target. Returns its wall
// time and the metrics line it printed.
function testProcess(target, env) {
  const targetArgs = target === "wasm" ? ["--target", "wasm32-wasip1"] : [];
  const started = performance.now();
  const run = spawnSync(
    "cargo",
    [
      "test",
      "--release",
      "--locked",
      "-p",
      "graph-layout",
      ...targetArgs,
      TEST,
      "--",
      "--nocapture",
      "--exact",
    ],
    { cwd: crates, env: { ...process.env, ...env }, encoding: "utf8" },
  );
  const ms = performance.now() - started;
  if (run.status !== 0) {
    throw new Error(
      `${target} test exited ${run.status}\n${run.stdout}${run.stderr}`,
    );
  }
  const match = LINE.exec(run.stdout);
  if (match === null) {
    throw new Error(
      `${target} test printed no layout-bench line\n${run.stdout}`,
    );
  }
  return { ms, line: match[1].trim() };
}

// The slope per pass for one target: the fastest wall time at each repeat count, and the metrics line of every run.
function measure({ target, graphPath, effort, repeats }) {
  const lines = new Set();
  const times = repeats.map((count) =>
    fastest(
      Array.from({ length: RUNS }, () => {
        const run = testProcess(target, {
          GRAPH_LAYOUT_BENCH_GRAPH: graphPath,
          GRAPH_LAYOUT_BENCH_EFFORT: effort,
          GRAPH_LAYOUT_BENCH_REPEATS: String(count),
        });
        lines.add(run.line);
        return run.ms;
      }),
    ),
  );
  return { perPass: (times[1] - times[0]) / (repeats[1] - repeats[0]), lines };
}

// One graph at one effort on both targets: the table rows, and every metrics line seen on either target.
function sweep({ name, graphPath, effort, repeats }) {
  const rows = [];
  const metrics = new Set();
  for (const target of ["native", "wasm"]) {
    const { perPass, lines } = measure({ target, graphPath, effort, repeats });
    rows.push(
      `| ${name} | ${effort} | ${target} | ${Math.round(perPass)} | ${[...lines].join(" / ")} |`,
    );
    lines.forEach((line) => metrics.add(line));
  }
  return { rows, metrics };
}

const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const dir = mkdtempSync(join(tmpdir(), "layout-timings-"));
try {
  const graphs = {
    finance: join(dir, "finance.txt"),
    synthetic: join(dir, "synthetic-3000.txt"),
  };
  writeFileSync(
    graphs.finance,
    flatten(financeGraph(manifest), `finance lineage graph of ${manifestPath}`),
  );
  writeFileSync(
    graphs.synthetic,
    flatten(
      syntheticGraph(SYNTHETIC_NODES, SYNTHETIC_SEED),
      `synthetic DAG: ${SYNTHETIC_NODES} nodes, seed ${SYNTHETIC_SEED}`,
    ),
  );

  let mismatch = false;
  console.log("| graph | effort | target | ms per pass | metrics line |");
  console.log("| --- | --- | --- | ---: | --- |");
  for (const [name, graphPath] of Object.entries(graphs)) {
    for (const [effort, repeats] of Object.entries(REPEATS[name])) {
      const { rows, metrics } = sweep({ name, graphPath, effort, repeats });
      rows.forEach((row) => console.log(row));
      if (metrics.size !== 1) {
        mismatch = true;
        console.error(
          `layout-timings: ${name} ${effort}: metrics differ: ${[...metrics].join(" / ")}`,
        );
      }
    }
  }
  if (mismatch) {
    process.exitCode = 1;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
