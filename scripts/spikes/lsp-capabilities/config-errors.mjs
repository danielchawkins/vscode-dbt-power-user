// Config-error behaviour: unknown --target, and a profiles.yml env_var that is unset.
//   node config-errors.mjs <root> <relFile> <outFile>
import fs from "node:fs";
import path from "node:path";
import { redactor, sleep, startServer, writeJson } from "./lib.mjs";

const [rootArg, rel, outFile] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const redact = redactor(root);
const profiles = path.join(root, "profiles.yml");
const original = fs.readFileSync(profiles, "utf8");
const cases = {
  "unknown --target": { extraArgs: ["--static-analysis", "strict", "--target", "nope"] },
  "profiles.yml env_var unset": {
    extraArgs: ["--static-analysis", "strict"],
    profiles: original.replace("path: 'jaffle_shop.duckdb'", "path: \"{{ env_var('FPU_PROBE_UNSET_PATH') }}\""),
  },
};
const out = {};
for (const [label, c] of Object.entries(cases)) {
  if (c.profiles) fs.writeFileSync(profiles, c.profiles);
  try {
    const server = await startServer({ root, extraArgs: c.extraArgs });
    server.openDoc(path.join(root, rel));
    await sleep(15000);
    const info = await server.exec("dbt.getProjectInfo", [], { timeoutMs: 5000 });
    const cur = await server.exec("dbt.getCurrentNode", [rel], { timeoutMs: 5000 });
    const hover = await server.request("textDocument/hover", { textDocument: { uri: `file://${path.join(root, rel)}` }, position: { line: 4, character: 25 } }, { timeoutMs: 5000 });
    out[label] = redact({
      events: server.events.filter((e) => e.kind !== "clientNotification").map((e) => ({ kind: e.kind, method: e.method, params: JSON.stringify(e.params ?? null).slice(0, 400) })),
      getProjectInfo: info.result ?? info.error,
      getCurrentNode: cur.result ?? cur.error,
      hover: hover.result ?? hover.error,
      stderr: server.stderr().slice(-1500),
      exitCode: server.child.exitCode,
    });
    console.log(label, JSON.stringify(out[label]).slice(0, 900));
    await server.stop();
  } finally {
    fs.writeFileSync(profiles, original);
  }
}
writeJson(outFile, out);
process.exit(0);
