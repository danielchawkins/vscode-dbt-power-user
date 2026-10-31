#!/usr/bin/env node
// Times placement (`place` with the problem it solves, `problemOf`) in TypeScript, Rust native and Rust under WASI, in
// milliseconds per pass, for the finance lineage graph (from a dbt manifest, as the parity dump print-fixtures.mjs
// place-finance) and a seeded 3,000-node synthetic DAG (syntheticDag). Each workload runs in both ranks modes, `rows` and
// `levels`, at the `fast` and `balanced` efforts. Each case is ordered by TypeScript and written as a placement case; the
// Rust core reads no clock (ADR 0011), so each Rust run is a whole test process (`place_timing_workload_runs`, native
// release, and wasm32-wasip1 release through Node's WASI) timed from outside at two repeat counts; the time per pass is
// the slope between them, which cancels process start-up and the parse of the case. TypeScript runs in process with its
// own two repeat counts. The Rust test checks the first placement's points against TypeScript's bit for bit, so the timed
// runs are the same computation. Every figure is the median of three runs.
//
//   node scripts/bench/place-timings.mjs [manifest.json]

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
const CASE_SEED = 7;
const DEFAULT_MANIFEST =
  "/Users/daniel/projects/finance-pipelines/conformance-staging/transformation/dbt/finance_general/target/manifest.json";
const EFFORTS = ["fast", "balanced"];
const RANKS = ["rows", "levels"];
// Repeat counts for each workload, mode and effort, two per runtime, so the slope spans a few seconds. The per-pass
// times these were chosen from are recorded in the discrepancy report.
const TYPESCRIPT_REPEATS = {
  finance: { fast: [2, 8], balanced: [2, 8] },
  synthetic: { fast: [1, 3], balanced: [1, 3] },
};
const RUST_REPEATS = {
  finance: { fast: [10, 110], balanced: [10, 110] },
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
      `cargo ${args.join(" ")} failed\n${run.stdout}${run.stderr}`,
    );
  }
  return { ms, stdout: run.stdout };
}

// The line the timed test prints once its first placement matches TypeScript's. Not anchored: under WASI the test harness
// writes its `test ... ` prefix before the line, on the same line.
const MATCHED = /place-timing: points match TypeScript/;

// The slope of the wall time between the two repeat counts, per pass, for one Rust target.
function rustPerPass(target, casePath, repeats) {
  const targetArgs = target === "wasm" ? ["--target", "wasm32-wasip1"] : [];
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
            "place_timing_workload_runs",
            "--",
            "--nocapture",
          ],
          {
            GRAPH_LAYOUT_PLACE_TIMING: casePath,
            GRAPH_LAYOUT_PLACE_REPEATS: String(k),
          },
        );
        if (!MATCHED.test(run.stdout)) {
          throw new Error(
            `${target}: the timed test did not match TypeScript\n${run.stdout}`,
          );
        }
        return run.ms;
      }),
    ),
  );
  return (times[1] - times[0]) / (repeats[1] - repeats[0]);
}

// The TypeScript resolve hook is registered before the sources load, as in the other parity and bench scripts.
register(pathToFileURL(join(root, "scripts/parity/ts-resolve.mjs")));
const { budgetOf } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/budget.ts")).href
);
const { indexed } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/indexed.ts")).href
);
const { rank } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/rank/index.ts")).href
);
const { layer } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/layering.ts")).href
);
const { order } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/order/index.ts")).href
);
const { place } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/place/index.ts")).href
);
const { brandesKoepf } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/place/brandesKoepf.ts"))
    .href
);
const { problemOf } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/place/links.ts")).href
);
const { seededRandom } = await import(
  pathToFileURL(join(root, "packages/graph-layout/src/random.ts")).href
);
const { financeGraph } = await import("../parity/finance-graph.mjs");
const { LINEAGE_OPTIONS, syntheticDag } =
  await import("../parity/layering-graphs.mjs");
const { caseLines, runCase } = await import("../parity/place-fixtures.mjs");

const deps = {
  indexed,
  budgetOf,
  rank,
  layer,
  order,
  place,
  brandesKoepf,
  problemOf,
};
const manifestPath = process.argv[2] ?? DEFAULT_MANIFEST;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const graphs = {
  finance: () => financeGraph(manifest),
  synthetic: () => syntheticDag(SYNTHETIC_NODES, seededRandom(SYNTHETIC_SEED)),
};

// Times one workload in one mode at one effort: the TypeScript pass, then the two Rust targets on the same case.
function timeWorkload(name, ranks, effort) {
  const graph = graphs[name]();
  const options = { ...LINEAGE_OPTIONS, ranks, direction: "down" };
  const run = runCase(
    { graph, options, seed: CASE_SEED, hinted: false, effort },
    deps,
  );
  const { input, withHints, ordering, spacing } = run;
  const label = `${name} ${ranks} ${effort}`;
  const dir = mkdtempSync(join(tmpdir(), "place-timing-"));
  try {
    const casePath = join(dir, "case.txt");
    const caseName = `${name}/${ranks}/${effort}`;
    const lines = caseLines(
      {
        name: caseName,
        graph,
        options,
        seed: CASE_SEED,
        hinted: false,
        effort,
      },
      deps,
    );
    writeFileSync(casePath, `${lines.join("\n")}\n`);
    // Rust's `solve` builds the problem and places it; TypeScript's pass does the same two calls.
    const typescriptPass = () => {
      place(input, withHints, ordering);
      problemOf(ordering, withHints, spacing);
    };
    const repeats = TYPESCRIPT_REPEATS[name][effort];
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
    const repeatsRust = RUST_REPEATS[name][effort];
    const native = rustPerPass("native", casePath, repeatsRust);
    const wasm = rustPerPass("wasm", casePath, repeatsRust);
    return {
      label,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      ts: (times[1] - times[0]) / (repeats[1] - repeats[0]),
      native,
      wasm,
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

const rows = [];
for (const name of Object.keys(graphs)) {
  for (const ranks of RANKS) {
    for (const effort of EFFORTS) {
      rows.push(timeWorkload(name, ranks, effort));
    }
  }
}

const f = (x) => x.toFixed(3).padStart(10);
console.log(
  `node ${process.version}; placement (place + problemOf), per pass in ms; x = TypeScript / Rust`,
);
console.log(
  "workload".padEnd(34) +
    "TypeScript".padStart(11) +
    "Rust native".padStart(13) +
    "Rust WASI".padStart(11) +
    "  native x  WASI x",
);
for (const r of rows) {
  console.log(
    `${r.label} (${r.nodes} nodes, ${r.edges} edges)`.padEnd(34) +
      f(r.ts).padStart(11) +
      f(r.native).padStart(13) +
      f(r.wasm).padStart(11) +
      `  ${(r.ts / r.native).toFixed(2).padStart(8)}  ${(r.ts / r.wasm).toFixed(2).padStart(8)}`,
  );
}
