// Intent: refactor-scout spike, second pass. After the first compile, measures where a column-lineage dbt.listNodes
// spends its time and whether the client can shorten it:
//   T1 table-grain listNodes; T2 one column target; T3 two column targets in one request (batching);
//   T4 a request cancelled with $/cancelRequest after CANCEL_AFTER_MS, then at once a second one (does the server
//      keep working on the cancelled request?); T5 getProjectInfo while a listNodes runs.
// Usage: DBT_BIN=<fusion> PROBE_UID=<uid> PROBE_COLUMN=<COL> PROBE_COLUMN2=<COL> PROBE_MODEL=<rel> \
//   node scripts/spikes/lsp-timing/cost.mjs finance /tmp/lsp-cost-finance.json
import { configs } from "../lsp-capabilities/configs.mjs";
import { startServer, sleep, writeJson, summarize } from "../lsp-capabilities/lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const { CancellationTokenSource } = createRequire(import.meta.url)("vscode-jsonrpc/node");
const [name = "jaffle", out = `/tmp/lsp-cost-${name}.json`] = process.argv.slice(2);
const base = configs[name];
const uid = process.env.PROBE_UID ?? base.uniqueId;
const col = process.env.PROBE_COLUMN ?? base.column;
const col2 = process.env.PROBE_COLUMN2 ?? col;
const model = process.env.PROBE_MODEL ?? base.files.model;
const root = fs.realpathSync(base.root);
const CANCEL_AFTER_MS = Number(process.env.CANCEL_AFTER_MS ?? 300);

const server = await startServer({ root, profilesDir: base.profilesDir ?? root, extraArgs: base.lspArgs });
const { conn, at } = server;
const ends = [];
conn.onUnhandledProgress((p) => {
  if (String(p.token).includes("dbt/progress/") && p.value?.kind) ends.push({ t: at(), token: String(p.token).split(":").pop(), kind: p.value.kind });
});
async function exec(label, args, { cancelAfterMs, command = "dbt.listNodes" } = {}) {
  const source = new CancellationTokenSource();
  if (cancelAfterMs !== undefined) setTimeout(() => source.cancel(), cancelAfterMs);
  const sentAt = at();
  const start = Date.now();
  try {
    const r = await conn.sendRequest("workspace/executeCommand", { command, arguments: args }, source.token);
    const entry = { label, sentAt, ms: Date.now() - start, nodes: r?.nodes?.length, error: r?.error ?? null, grain: r?.grain, head: summarize(r, 160) };
    console.log(JSON.stringify(entry));
    return entry;
  } catch (e) {
    const entry = { label, sentAt, ms: Date.now() - start, rpcError: { code: e.code, message: e.message } };
    console.log(JSON.stringify(entry));
    return entry;
  }
}
server.openDoc(path.join(root, model));
await server.waitNotification("dbt/lspCompileComplete", { timeoutMs: 600000 });
const r = {};
r.T1_table = await exec("T1 table", [`+${uid}+`]);
r.T2_column = await exec("T2 column", [`@${uid}`, `+column:${uid}.${col}+`]);
r.T2b_column_again = await exec("T2b column again", [`@${uid}`, `+column:${uid}.${col}+`]);
r.T3_two_targets = await exec("T3 two targets", [`@${uid}`, `+column:${uid}.${col}+`, `+column:${uid}.${col2}+`]);
const cancelled = exec("T4 cancelled", [`@${uid}`, `+column:${uid}.${col}+`], { cancelAfterMs: CANCEL_AFTER_MS });
await sleep(CANCEL_AFTER_MS + 20);
const after = exec("T4b right after cancel", [`@${uid}`, `+column:${uid}.${col2}+`]);
await sleep(50);
r.T5_projectInfo_during = await exec("T5 getProjectInfo during listNodes", [], { command: "dbt.getProjectInfo" });
r.T4_cancelled = await cancelled;
r.T4b_after = await after;
r.progress = ends;
// Server silence while T2 ran: the longest gap between any two server messages (notifications, server requests,
// $/progress) inside T2's window. A stall timer that resets on server activity would need to exceed this.
const serverTimes = [
  ...server.events.filter((e) => e.kind !== "clientNotification").map((e) => e.t),
  ...ends.map((e) => e.t),
].sort((a, b) => a - b);
const windowStart = r.T2_column.sentAt;
const windowEnd = windowStart + r.T2_column.ms;
const inWindow = [windowStart, ...serverTimes.filter((t) => t > windowStart && t < windowEnd), windowEnd];
r.T2_longestServerSilenceMs = Math.max(...inWindow.slice(1).map((t, i) => t - inWindow[i]));
r.T2_serverMessages = inWindow.length - 2;
console.log(JSON.stringify({ T2_longestServerSilenceMs: r.T2_longestServerSilenceMs, T2_serverMessages: r.T2_serverMessages }));
writeJson(out, r);
await server.stop();
process.exit(0);
