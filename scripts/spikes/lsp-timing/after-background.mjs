// Intent: refactor-scout spike. Is a column-lineage dbt.listNodes cheaper once the server's background full compile
// has completed? Opens one model, waits for dbt/lspBackgroundCompileComplete without sending anything, then sends the
// same column-lineage request three times and records each latency and the compile notifications it caused.
// Usage: DBT_BIN=<fusion> PROBE_UID=<uid> PROBE_COLUMN=<COL> PROBE_MODEL=<rel> node scripts/spikes/lsp-timing/after-background.mjs finance
import { configs } from "../lsp-capabilities/configs.mjs";
import { startServer } from "../lsp-capabilities/lib.mjs";
import fs from "node:fs";
import path from "node:path";

const [name = "jaffle"] = process.argv.slice(2);
const base = configs[name];
const uid = process.env.PROBE_UID ?? base.uniqueId;
const col = process.env.PROBE_COLUMN ?? base.column;
const root = fs.realpathSync(base.root);
const s = await startServer({ root, profilesDir: base.profilesDir ?? root, extraArgs: base.lspArgs });
s.openDoc(path.join(root, process.env.PROBE_MODEL ?? base.files.model));
const fg = await s.waitNotification("dbt/lspCompileComplete", { timeoutMs: 600000 });
const bgStart = await s.waitNotification("dbt/lspBackgroundCompileStart", { timeoutMs: 600000 });
const bg = await s.waitFor((e) => e.method === "dbt/lspBackgroundCompileComplete" && e.params?.compile_type === "full", { timeoutMs: 600000 });
console.log(JSON.stringify({ firstCompileAt: fg.t, backgroundStartAt: bgStart.t, backgroundDoneAt: bg.t, backgroundMs: bg.params?.duration_ms }));
for (let i = 0; i < 3; i++) {
  const before = s.events.length;
  const r = await s.exec("dbt.listNodes", [`@${uid}`, `+column:${uid}.${col}+`]);
  const compiles = s.events.slice(before).filter((e) => e.method?.startsWith("dbt/")).map((e) => `${e.method}:${e.params?.duration_ms ?? ""}`);
  console.log(JSON.stringify({ i, ms: r.ms, nodes: r.result?.nodes?.length, error: r.result?.error ?? null, compiles }));
}
await s.stop();
process.exit(0);
