// Intent: measure where the VPSC time goes, before the solver changes. Two probes on this checkout's source:
//   warm      a scratch warm start (previous active set and offsets) against the cold solver on random sequences: how
//             often the result is bit-identical, and the largest difference;
//   finance   the finance lineage graph (dbt manifest) laid out at `balanced` and `fast`, with self-time by function from
//             an in-process CPU profile, so the share of the solver (vpsc*.ts) is visible;
//   quadratic merging chains of n = 128 to 1,024 variables solved by solveSeparations, reporting solve time per n and
//             x0 reads per variable (a counting proxy over x0; the solver reads x0 in its rebuild and multiplier walks).
// Usage (from the repo root, Node 24 as pinned in mise.toml):
//   node scripts/spikes/graph-layout/vpsc-spike.mjs quadratic [--out DIR]
//   node scripts/spikes/graph-layout/vpsc-spike.mjs warm [--out DIR]     (warm-start feasibility: bit-identity vs cold)
//   node scripts/spikes/graph-layout/vpsc-spike.mjs finance <manifest.json> [--out DIR] [--runs N]
// The bundles are built with rolldown into DIR (default: the OS temp directory); nothing is written into the package.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Session } from "node:inspector/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const mode = args[0];
const outDir = flag("--out", join(tmpdir(), "vpsc-spike"));
mkdirSync(outDir, { recursive: true });

function bundle(name, source) {
  const entry = join(outDir, `${name}-entry.ts`);
  const file = join(outDir, `${name}.mjs`);
  execFileSync(
    join(repo, "node_modules/.bin/rolldown"),
    [entry, "--format", "esm", "--platform", "node", "--file", file],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return file;
}

function writeEntry(name, line) {
  const entry = join(outDir, `${name}-entry.ts`);
  execFileSync("sh", ["-c", `printf '%s\\n' "$1" > "$2"`, "sh", line, entry]);
  return entry;
}

function importBundle(file) {
  return import(pathToFileURL(file).href);
}

// Median of a sorted-ascending list.
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Wraps x0 so every indexed read is counted; the solver reads x0 only through indexing, `map` and `length`.
function countingReads(x0) {
  const reads = Array.from({ length: x0.length }, () => 0);
  const proxy = new Proxy(x0, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        reads[Number(key)] += 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, reads };
}

// Merging chains: separations i -> i+1 with gap 1, and targets that all sit at one point, so every chain link must merge.
// `reverse` pulls the chain's ends the other way, so the merges propagate along it.
function chain(n, shape) {
  const seps = Array.from({ length: n - 1 }, (_, i) => ({
    from: i,
    to: i + 1,
    gap: 1,
  }));
  const x0 =
    shape === "collapse"
      ? Array.from({ length: n }, () => 0)
      : Array.from({ length: n }, (_, i) => (n - i) * 0.25);
  return { x0, weight: Array.from({ length: n }, () => 1), seps };
}

async function quadratic() {
  const solve = (await importBundle(
    bundle(
      "solve",
      writeEntry(
        "solve",
        `export { solveSeparations } from "${repo}/packages/graph-layout/src/solve/vpsc.ts";`,
      ),
    ),
  )).solveSeparations;
  console.log("shape     n    solve ms   x0 reads per variable (mean, max)");
  for (const shape of ["collapse", "reverse"]) {
    for (const n of [128, 256, 512, 1024]) {
      const { x0, weight, seps } = chain(n, shape);
      solve(x0, weight, seps); // warm-up
      const times = [];
      const repeats = Math.max(3, Math.round(2000 / n));
      for (let r = 0; r < repeats; r++) {
        const t0 = performance.now();
        solve(x0, weight, seps);
        times.push(performance.now() - t0);
      }
      const counted = countingReads(x0);
      solve(counted.proxy, weight, seps);
      const perVar = counted.reads;
      const mean = perVar.reduce((a, b) => a + b, 0) / n;
      console.log(
        `${shape.padEnd(9)} ${String(n).padStart(4)}   ${median(times).toFixed(2).padStart(8)}   ${mean.toFixed(1).padStart(8)} (${Math.max(...perVar)})`,
      );
    }
  }
}

// Self-time per function from an in-process CPU profile of `run`.
async function profile(run) {
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 200 });
  await session.post("Profiler.start");
  await run();
  const { profile: prof } = await session.post("Profiler.stop");
  await session.post("Profiler.disable");
  const byId = new Map(prof.nodes.map((node) => [node.id, node]));
  const self = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
  }
  const byFn = new Map();
  let total = 0;
  for (const [id, t] of self) {
    const frame = byId.get(id).callFrame;
    const url = frame.url || "(native)";
    const key = `${frame.functionName || "(anon)"} ${url.split("/").slice(-1)[0]}:${frame.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + t);
    total += t;
  }
  // Function names as the bundle keeps them: the solver's methods and the projection entry points.
  const solverNames =
    /^(solveSeparations|walkBlock|spanningOrder|componentOrder|negativeIn|multipliers|rebuild|path|split|join|resolveWithin|shiftBlock|satisfy|splitNegative|splitNegativeIn|mostViolated|checkedInput|assertAcyclic|projectAxis|project|projectRanks|reduceEqualities) /;
  const solver = [...byFn]
    .filter(([k]) => solverNames.test(k))
    .reduce((a, [, t]) => a + t, 0);
  return { byFn, total, solver };
}

async function finance() {
  const manifestPath = args[1];
  const runs = Number(flag("--runs", "1"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const { layout } = await importBundle(
    bundle(
      "layout",
      writeEntry(
        "layout",
        `export { layout } from "${repo}/packages/graph-layout/src/index.ts";`,
      ),
    ),
  );
  // Graph construction as in /tmp/bench/full-graph.mjs: the dbt lineage of the connected part, four layer bands and
  // one cluster per unlayered node.
  const LAYERS = ["source", "staging", "intermediate", "marts"];
  const tagOf = (id, node) => {
    if (id.startsWith("source.")) return "source";
    const p = node?.original_file_path ?? "";
    if (/staging/.test(p)) return "staging";
    if (/intermediate/.test(p)) return "intermediate";
    if (/marts/.test(p)) return "marts";
    return "other";
  };
  const all = { ...manifest.nodes, ...manifest.sources };
  const keep = (id) => !id.startsWith("test.") && all[id] !== undefined;
  const used = new Set();
  const pairs = [];
  for (const [child, parents] of Object.entries(manifest.parent_map)) {
    if (!keep(child)) continue;
    for (const parent of parents) {
      if (keep(parent)) {
        pairs.push([parent, child]);
        used.add(parent);
        used.add(child);
      }
    }
  }
  const ids = [...used];
  const tags = ids.map((id) => tagOf(id, all[id]));
  const graph = {
    nodes: ids.map((id, i) => ({
      id,
      width: 280,
      height: 65,
      ...(tags[i] === "other" ? {} : { partition: LAYERS.indexOf(tags[i]) }),
      cluster: tags[i] === "other" ? `other:${id}` : tags[i],
    })),
    edges: pairs.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, kind: "table" })),
    clusters: [
      ...LAYERS.map((id) => ({ id, padding: 22 })),
      ...ids.filter((_, i) => tags[i] === "other").map((id) => ({ id: `other:${id}`, padding: 22 })),
    ],
  };
  console.log(`nodes ${graph.nodes.length} edges ${graph.edges.length}`);
  const options = (effort) => ({
    direction: "down",
    edgeKinds: { table: { ranks: true } },
    partitions: "soft",
    ranks: "rows",
    effort,
    spacing: { node: 28, rank: 36, edge: 6, cluster: 28 },
  });
  for (const effort of ["fast", "balanced"]) {
    const times = [];
    for (let r = 0; r < runs; r++) {
      const t0 = performance.now();
      layout(graph, options(effort));
      times.push(performance.now() - t0);
    }
    console.log(`${effort}: ms per run ${times.map((t) => Math.round(t)).join(", ")} (median ${Math.round(median(times))})`);
  }
  const prof = await profile(() => layout(graph, options("balanced")));
  console.log(`balanced profile: ${Math.round(prof.total / 1000)} ms self time, projection/solver share ${((100 * prof.solver) / prof.total).toFixed(1)}%`);
  [...prof.byFn]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([k, t]) => console.log(`${((100 * t) / prof.total).toFixed(1).padStart(5)}% ${(t / 1000).toFixed(0).padStart(6)} ms  ${k}`));
}

// Scratch warm start for the feasibility question: restore the previous solve's active set and offsets (the offsets
// keep the tight separations tight), recompute the blocks for the new desired positions, then run the cold solver's
// merge and split loop. Written with the solver's own Blocks class; it is a probe, not a replacement for the solver.
const VIOLATION = 1e-9;
const MULTIPLIER = 1e-9;
function mostViolated(b, within) {
  let worst;
  let worstSlack = -VIOLATION;
  for (let e = 0; e < b.count; e++) {
    if (b.active[e] || b.sameBlock(e) !== within) continue;
    const slack = b.slack(e);
    if (slack < worstSlack) {
      worst = e;
      worstSlack = slack;
    }
  }
  return worst;
}
function splitNegative(b) {
  const lam = b.multipliers();
  const negative = [];
  for (let e = 0; e < b.count; e++) if (b.active[e] && lam[e] < -MULTIPLIER) negative.push(e);
  if (negative.length === 0) return false;
  b.split(negative);
  return true;
}
function warmSolve(Blocks, x0, weight, seps, prev) {
  const b = new Blocks({
    x0,
    weight,
    from: seps.map((s) => s.from),
    to: seps.map((s) => s.to),
    gap: seps.map((s) => s.gap),
  });
  if (prev) {
    prev.active.forEach((on, e) => {
      if (on) {
        b.active[e] = true;
        b.forest.link(e);
      }
    });
    prev.off.forEach((o, v) => {
      b.off[v] = o;
    });
    b.rebuild();
  }
  do {
    for (;;) {
      const across = mostViolated(b, false);
      if (across !== undefined) {
        b.join(across);
        while (splitNegative(b));
        continue;
      }
      const within = mostViolated(b, true);
      if (within === undefined) break;
      b.resolveWithin(within);
      while (splitNegative(b));
    }
  } while (splitNegative(b));
  return { x: x0.map((_, v) => b.value(v)), state: { active: [...b.active], off: [...b.off] } };
}

async function warm() {
  const { Blocks, solveSeparations: cold } = await importBundle(
    bundle(
      "internals",
      writeEntry(
        "internals",
        `export { Blocks } from "${repo}/packages/graph-layout/src/solve/vpscBlocks.ts";\nexport { solveSeparations } from "${repo}/packages/graph-layout/src/solve/vpsc.ts";`,
      ),
    ),
  );
  // A seeded generator, so the run repeats exactly.
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cost = (x, x0, w) => x.reduce((a, xi, i) => a + w[i] * (xi - x0[i]) ** 2, 0);
  let projections = 0;
  let identical = 0;
  let maxDiff = 0;
  let maxRelCost = 0;
  for (let instance = 0; instance < 300; instance++) {
    const n = 5 + Math.floor(rand() * 40);
    const seps = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (rand() < 3 / n) seps.push({ from: i, to: j, gap: 0.5 + rand() * 1.5 });
    const weight = Array.from({ length: n }, () => 0.5 + rand() * 1.5);
    let x0 = Array.from({ length: n }, () => rand() * 20);
    let prev;
    for (let step = 0; step < 8; step++) {
      x0 = x0.map((v) => v + (rand() - 0.5) * 3);
      const expected = cold(x0, weight, seps);
      const got = warmSolve(Blocks, x0, weight, seps, prev);
      prev = got.state;
      projections++;
      if (expected.every((c, v) => Object.is(c, got.x[v]))) identical++;
      expected.forEach((c, v) => {
        maxDiff = Math.max(maxDiff, Math.abs(c - got.x[v]));
      });
      const ce = cost(expected, x0, weight);
      maxRelCost = Math.max(maxRelCost, Math.abs(ce - cost(got.x, x0, weight)) / Math.max(1, Math.abs(ce)));
    }
  }
  console.log(
    `warm start, ${projections} projections: bit-identical ${identical} (${((100 * identical) / projections).toFixed(1)}%), max coordinate difference ${maxDiff.toExponential(2)}, max relative cost difference ${maxRelCost.toExponential(2)}`,
  );
}

if (mode === "quadratic") {
  await quadratic();
} else if (mode === "finance") {
  await finance();
} else if (mode === "warm") {
  await warm();
} else {
  console.error("usage: vpsc-spike.mjs quadratic | warm | finance <manifest.json> [--runs N] [--out DIR]");
  process.exit(2);
}
