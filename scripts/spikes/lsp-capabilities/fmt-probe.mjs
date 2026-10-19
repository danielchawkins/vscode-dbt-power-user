// Formatting and fix-all over the language server, against a finance copy. Usage:
//   node fmt-probe.mjs <projectRoot> <relModel>...
import fs from "node:fs";
import path from "node:path";
import { fileUri, startServer } from "./lib.mjs";

const [rootArg, ...models] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const server = await startServer({
  root,
  extraArgs: process.env.FMT_PROBE_DEBUG ? ["--log-level", "debug", "--log-level-file", "debug"] : [],
});
for (const rel of models) {
  const abs = path.join(root, rel);
  server.openDoc(abs);
}
await server.waitNotification("dbt/lspCompileComplete", { timeoutMs: 180000 });
for (const rel of models) {
  const td = { textDocument: { uri: fileUri(path.join(root, rel)) } };
  const fmt = await server.request("textDocument/formatting", { ...td, options: { tabSize: 4, insertSpaces: true } });
  const fix = await server.request("textDocument/codeAction", {
    ...td,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics: [], only: ["source.fixAll"] },
  });
  const describe = (e) => (e.error ? `error ${e.error.code} ${e.error.message}` : `ok ${JSON.stringify(e.result)?.slice(0, 80)}`);
  console.log(`${rel}\n  formatting: ${describe(fmt)}\n  fixAll:     ${describe(fix)}`);
}
console.log("stderr tail:", server.stderr().slice(-1500));
await server.stop();
