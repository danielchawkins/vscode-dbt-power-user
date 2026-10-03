// Column lineage across models and spellings: which `dbt.listNodes` column requests return nodes.
//   node column-lineage.mjs <config> <outFile> <relPath>...
import fs from "node:fs";
import path from "node:path";
import { configs } from "./configs.mjs";
import { redactor, startServer, writeJson } from "./lib.mjs";

const [configName, outFile, ...files] = process.argv.slice(2);
const cfg = configs[configName];
const root = fs.realpathSync(cfg.root);
const redact = redactor(root);
const server = await startServer({ root, profilesDir: cfg.profilesDir ?? root, extraArgs: cfg.lspArgs, env: cfg.env });
server.openDoc(path.join(root, files[0]));
await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: 600000 });
const out = [];
for (const rel of files) {
  const cur = (await server.exec("dbt.getCurrentNode", [rel])).result?.node;
  if (!cur) { out.push({ rel, node: null }); continue; }
  const uid = cur.unique_id;
  const cols = Object.keys(cur.columns ?? {}).slice(0, 3);
  for (const col of cols) {
    for (const spelled of [col, col.toLowerCase()]) {
      for (const args of [[`@${uid}`, `+column:${uid}.${spelled}+`], [`+column:${uid}.${spelled}+`]]) {
        const e = await server.exec("dbt.listNodes", args);
        const row = { rel, static_analysis: cur.static_analysis, args, ms: e.ms, nodes: e.result?.nodes?.length ?? null, error: e.result?.error ?? e.error ?? null,
          sample: e.result?.nodes?.slice(0, 3).map((n) => ({ unique_id: n.unique_id, op: n.op, parents: n.parents })) };
        out.push(row);
        console.log(JSON.stringify(redact(row)).slice(0, 260));
      }
    }
  }
}
writeJson(outFile, redact(out));
await server.stop();
process.exit(0);
