// Code lens conditions: static-analysis mode, before/after save, and with the jinja-sql vs sql language id.
//   node lenses.mjs <root> <relFile>
import fs from "node:fs";
import path from "node:path";
import { fileUri, sleep, startServer, writeJson } from "./lib.mjs";

const [rootArg, rel, out] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const file = path.join(root, rel);
const results = [];
for (const mode of ["baseline", "strict"]) {
  for (const languageId of ["jinja-sql", "sql"]) {
    const server = await startServer({ root, extraArgs: ["--static-analysis", mode] });
    server.openDoc(file, languageId);
    await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: 300000 });
    await sleep(1000);
    const first = await server.request("textDocument/codeLens", { textDocument: { uri: fileUri(file) } });
    server.save(file);
    await sleep(3000);
    const afterSave = await server.request("textDocument/codeLens", { textDocument: { uri: fileUri(file) } });
    const refreshes = server.events.filter((e) => e.method === "workspace/codeLens/refresh").length;
    results.push({ mode, languageId, first: first.result ?? first.error, afterSave: afterSave.result ?? afterSave.error, refreshes });
    console.log(mode, languageId, JSON.stringify(first.result)?.slice(0, 300), JSON.stringify(afterSave.result)?.slice(0, 300));
    await server.stop();
  }
}
if (out) writeJson(out, results);
process.exit(0);
