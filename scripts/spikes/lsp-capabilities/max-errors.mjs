// Whether the server honours `lsp.maxErrorReporting` from workspace/configuration: opens one model in a project with
// several broken refs, with and without a limit of 1, and counts the errors each compile reports.
//   node max-errors.mjs <root> <relFile> <outFile>
import fs from "node:fs";
import path from "node:path";
import { redactor, sleep, startServer, writeJson } from "./lib.mjs";

const [rootArg, rel, outFile] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const redact = redactor(root);
const cases = {
  "no limit": { lsp: { linter: { enabled: false } } },
  "maxErrorReporting 1": { lsp: { linter: { enabled: false }, maxErrorReporting: 1 } },
};
const out = {};
for (const [label, dbtConfig] of Object.entries(cases)) {
  const server = await startServer({ root, dbtConfig });
  server.openDoc(path.join(root, rel));
  await sleep(20000);
  const compiles = server.events.filter((e) => e.method?.startsWith("dbt/lsp") && e.method.endsWith("CompileComplete"));
  const diagnostics = server.events.filter((e) => e.method === "textDocument/publishDiagnostics");
  out[label] = redact({
    configurationRequests: server.events.filter((e) => e.method === "workspace/configuration").length,
    compileErrorCounts: compiles.map((e) => (e.params?.errors ?? []).length),
    diagnosticFiles: new Set(diagnostics.filter((e) => e.params.diagnostics.length > 0).map((e) => e.params.uri)).size,
    diagnosticTotal: diagnostics.reduce((n, e) => n + e.params.diagnostics.length, 0),
  });
  await server.stop();
}
writeJson(outFile, out);
console.log(JSON.stringify(out, null, 2));
