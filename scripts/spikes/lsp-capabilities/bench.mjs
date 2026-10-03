// LSP versus CLI latency for lineage, compiled SQL and a 10-row preview, p50/p95 of N runs each.
//   node bench.mjs <config> <outFile> [N]
// The CLI side runs what the extension runs today (src/core/cli/cliArgs.ts): `dbt parse --log-format json` for the
// manifest, `dbt compile --inline <sql> --output json --log-format json --log-level debug`, and
// `dbt show --log-level debug --inline <sql> --limit 10 --output json --log-format json`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { configs } from "./configs.mjs";
import { DBT, fileUri, percentile, startServer, writeJson } from "./lib.mjs";

const run = promisify(execFile);
const [configName, outFile, nArg = "5"] = process.argv.slice(2);
const cfg = configs[configName];
const N = Number(nArg);
const root = fs.realpathSync(cfg.root);
const profilesDir = cfg.profilesDir ?? root;
const results = {};
const time = async (label, fn) => {
  const ms = [];
  let last;
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    last = await fn();
    ms.push(Date.now() - t);
  }
  results[label] = { p50: percentile(ms, 50), p95: percentile(ms, 95), samples: ms, check: last };
  console.log(label, JSON.stringify(results[label]).slice(0, 300));
};
const cli = async (args) => {
  try {
    const { stdout } = await run(DBT, [...args, "--project-dir", root, "--profiles-dir", profilesDir], { cwd: root, maxBuffer: 1 << 28 });
    return { ok: true, bytes: stdout.length };
  } catch (e) {
    return { ok: false, code: e.code, bytes: e.stdout?.length };
  }
};

// Pick the p50 and p95 models by transitive lineage size from a CLI parse.
await cli(["parse", "--log-format", "json"]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, "target/manifest.json"), "utf8"));
const closure = (start, map) => {
  const seen = new Set();
  const stack = [start];
  while (stack.length) for (const x of map[stack.pop()] ?? []) if (!seen.has(x)) { seen.add(x); stack.push(x); }
  return seen;
};
const rootPkg = manifest.metadata.project_name;
const models = Object.values(manifest.nodes).filter((n) => n.resource_type === "model" && n.package_name === rootPkg);
const sized = models.map((n) => ({ n, size: closure(n.unique_id, manifest.parent_map).size + closure(n.unique_id, manifest.child_map).size }))
  .sort((a, b) => a.size - b.size);
const picks = { p50: sized[Math.floor(sized.length * 0.5)], p95: sized[Math.min(sized.length - 1, Math.floor(sized.length * 0.95))] };
results.models = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, { unique_id: v.n.unique_id, path: v.n.original_file_path, lineageSize: v.size }]));
console.log("models", JSON.stringify(results.models));

// CLI path for lineage: parse, then read and index manifest.json as the extension does.
await time("cli parse + manifest read (lineage source)", async () => {
  const r = await cli(["parse", "--log-format", "json"]);
  const t = Date.now();
  const m = JSON.parse(fs.readFileSync(path.join(root, "target/manifest.json"), "utf8"));
  return { ...r, readMs: Date.now() - t, nodes: Object.keys(m.nodes).length };
});
await time("manifest read only (in-memory lineage after parse)", async () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "target/manifest.json"), "utf8"));
  return { parents: closure(picks.p95.n.unique_id, m.parent_map).size };
});
for (const [k, { n }] of Object.entries(picks)) {
  const sql = fs.readFileSync(path.join(root, n.original_file_path), "utf8");
  await time(`cli compile --inline ${k} model`, () => cli(["compile", "--inline", sql, "--output", "json", "--log-format", "json", "--log-level", "debug"]));
  await time(`cli show --inline ${k} model limit 10`, () => cli(["show", "--log-level", "debug", "--inline", sql, "--limit", "10", "--output", "json", "--log-format", "json"]));
}

// LSP path.
const server = await startServer({ root, profilesDir, extraArgs: cfg.lspArgs, env: cfg.env });
const tOpen = Date.now();
server.openDoc(path.join(root, picks.p50.n.original_file_path));
await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: 600000 });
results["lsp didOpen -> background compile complete"] = { ms: Date.now() - tOpen };
for (const [k, { n }] of Object.entries(picks)) {
  const name = n.name;
  const file = path.join(root, n.original_file_path);
  const value = (e) => (e.error ? e.error : e.result?.error ? { error: e.result.error } : undefined);
  await time(`lsp listNodes +${k}+ (table lineage, all hops)`, async () => {
    const e = await server.exec("dbt.listNodes", [`+${name}+`]);
    return value(e) ?? { nodes: e.result?.nodes?.length };
  });
  await time(`lsp listNodes 1+${k}+1 (one hop)`, async () => {
    const e = await server.exec("dbt.listNodes", [`1+${name}+1`]);
    return value(e) ?? { nodes: e.result?.nodes?.length };
  });
  const cols = Object.keys((await server.exec("dbt.getCurrentNode", [n.original_file_path])).result?.node?.columns ?? {});
  if (cols.length) {
    await time(`lsp listNodes column lineage ${k} (${cols[0]})`, async () => {
      const e = await server.exec("dbt.listNodes", [`@${n.unique_id}`, `+column:${n.unique_id}.${cols[0]}+`]);
      return value(e) ?? { nodes: e.result?.nodes?.length };
    });
  }
  await time(`lsp getCurrentNode ${k}`, async () => {
    const e = await server.exec("dbt.getCurrentNode", [n.original_file_path]);
    return value(e) ?? { columns: Object.keys(e.result?.node?.columns ?? {}).length };
  });
  await time(`lsp compileFile ${k} (+ read compiled file)`, async () => {
    const e = await server.exec("dbt.compileFile", [fileUri(file)]);
    const p = e.result?.file_uri ? new URL(e.result.file_uri).pathname : undefined;
    return value(e) ?? { bytes: p && fs.existsSync(p) ? fs.readFileSync(p, "utf8").length : null };
  });
  await time(`lsp show {uri} ${k} limit 10`, async () => {
    const e = await server.exec("dbt.show", [{ uri: fileUri(file), limit: 10 }]);
    return value(e) ?? { columns: e.result?.columns?.length, rows: e.result?.data?.length };
  });
}
await server.stop();
writeJson(outFile, results);
process.exit(0);
