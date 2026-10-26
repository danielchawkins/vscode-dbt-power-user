// Intent: refactor-scout spike. Measures what the Fusion language server tells a client about its own work, so the
// extension can gate requests on events instead of fixed deadlines. Records, with timestamps from server start:
// every dbt/* notification, every $/progress begin/report/end (with title), and the latency and outcome of
//   A. a column-lineage dbt.listNodes sent before the first compile completes;
//   B. two concurrent dbt.listNodes (does the server supersede the earlier one, and how does it say so?);
//   C. a dbt.listNodes cancelled with $/cancelRequest after CANCEL_AFTER_MS (error code? does work stop?);
//   D. a dbt.listNodes sent during a didSave-triggered recompile;
//   E. dbt.getCurrentNode and dbt.compileFile sent together with a dbt.listNodes.
// Usage: DBT_BIN=<fusion> node scripts/spikes/lsp-timing/timing.mjs <jaffle|finance> <out.json>
import { configs } from "../lsp-capabilities/configs.mjs";
import { startServer, fileUri, sleep, writeJson, summarize } from "../lsp-capabilities/lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const { CancellationTokenSource } = createRequire(import.meta.url)("vscode-jsonrpc/node");

const [name = "jaffle", out = `/tmp/lsp-timing-${name}.json`] = process.argv.slice(2);
// PROBE_MODEL / PROBE_UID / PROBE_COLUMN override the target's model when the copy has moved on.
const base = configs[name];
const cfg = {
  ...base,
  uniqueId: process.env.PROBE_UID ?? base.uniqueId,
  column: process.env.PROBE_COLUMN ?? base.column,
  files: { ...base.files, model: process.env.PROBE_MODEL ?? base.files.model },
};
const root = fs.realpathSync(cfg.root);
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS ?? 30);
const column = [`@${cfg.uniqueId}`, `+column:${cfg.uniqueId}.${cfg.column}+`];

const server = await startServer({ root, profilesDir: cfg.profilesDir ?? root, extraArgs: cfg.lspArgs });
const { conn, events, at } = server;
// vscode-jsonrpc routes $/progress to per-token handlers and drops the rest from onNotification; record them here.
const progressTitles = new Map();
conn.onUnhandledProgress((params) => {
  if (params?.value?.kind === "begin") progressTitles.set(params.token, params.value.title);
  events.push({ t: at(), kind: "notification", method: "$/progress", params, title: progressTitles.get(params.token) });
});
const log = (label, extra = {}) => console.log(JSON.stringify({ t: at(), label, ...extra }));

/** Sends executeCommand with an explicit token so the probe can cancel; never rejects. */
async function exec(command, args, { cancelAfterMs, workDoneToken } = {}) {
  const start = Date.now();
  const sentAt = at();
  const rpc = conn;
  const source = new CancellationTokenSource();
  if (cancelAfterMs !== undefined) setTimeout(() => source.cancel(), cancelAfterMs);
  try {
    const result = await rpc.sendRequest("workspace/executeCommand", { command, arguments: args, ...(workDoneToken ? { workDoneToken } : {}) }, source.token);
    return { command, sentAt, ms: Date.now() - start, result: summarize(result, 300) };
  } catch (error) {
    return { command, sentAt, ms: Date.now() - start, error: { code: error.code, message: error.message } };
  }
}

const results = {};
const modelPath = path.join(root, cfg.files.model);
server.openDoc(modelPath);

// A: before the first compile.
results.A_beforeFirstCompile = await exec("dbt.listNodes", column);
log("A", results.A_beforeFirstCompile);
await server.waitNotification("dbt/lspCompileComplete", { timeoutMs: cfg.loadTimeoutMs ?? 300000 });
log("first compile complete");

// B: two concurrent requests.
results.B_concurrent = await Promise.all([exec("dbt.listNodes", column), exec("dbt.listNodes", column)]);
log("B", { r: results.B_concurrent });

// C: cancelled after CANCEL_AFTER_MS; then an immediate follow-up shows whether the server is still busy.
results.C_cancelled = await exec("dbt.listNodes", column, { cancelAfterMs: CANCEL_AFTER_MS });
results.C_followUp = await exec("dbt.listNodes", column);
log("C", { c: results.C_cancelled, f: results.C_followUp });

// D: during a recompile triggered by didSave.
const before = server.count("dbt/lspCompileComplete");
server.save(modelPath);
await sleep(20);
results.D_duringRecompile = await exec("dbt.listNodes", column);
const next = await server.nextEvent("dbt/lspCompileComplete", before, 300000);
results.D_compileCompleteAt = next.t;
log("D", results.D_duringRecompile);

// E: other command classes alongside listNodes.
results.E_mixed = await Promise.all([
  exec("dbt.listNodes", column),
  exec("dbt.getCurrentNode", [cfg.files.model]),
  exec("dbt.compileFile", [fileUri(modelPath)]),
]);
log("E", { r: results.E_mixed });

// F: a client-supplied workDoneToken; does the server report progress on it?
results.F_clientToken = await exec("dbt.listNodes", column, { workDoneToken: "fpu-probe-token" });
log("F", results.F_clientToken);

// Wait for the background compile, if any, so its notifications land in the timeline.
await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: cfg.loadTimeoutMs ?? 300000 });

results.timeline = events
  .filter((e) => e.kind !== "clientNotification" || e.method !== "textDocument/didOpen")
  .filter((e) => /^dbt\/|^\$\/progress|workDoneProgress|cancelRequest/.test(e.method))
  .map((e) => ({
    t: e.t,
    method: e.method,
    title: e.title,
    token: e.params?.token,
    value: e.params?.value && { kind: e.params.value.kind, message: e.params.value.message, title: e.params.value.title },
    dbt: e.method.startsWith("dbt/")
      ? { compile_type: e.params?.compile_type, duration_ms: e.params?.duration_ms, models_count: e.params?.models_count, errors: e.params?.errors?.length }
      : undefined,
  }));
writeJson(out, results);
await server.stop();
console.log(`wrote ${out}`);
process.exit(0);
