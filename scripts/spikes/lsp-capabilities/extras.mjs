// Follow-up checks: compileFile and getCurrentNode against unsaved edits, getCurrentNode on non-model files,
// adapter introspection through dbt.show, and a whole-project graph from one listNodes call.
//   node extras.mjs <root> <outFile>
import fs from "node:fs";
import path from "node:path";
import { fileUri, redactor, sleep, startServer, writeJson } from "./lib.mjs";

const [rootArg, outFile] = process.argv.slice(2);
const root = fs.realpathSync(rootArg);
const redact = redactor(root);
const server = await startServer({ root, extraArgs: ["--static-analysis", "strict"] });
const model = path.join(root, "models/orders.sql");
server.openDoc(model);
await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: 120000 });
await sleep(500);
const out = {};
const compiledText = async () => {
  const e = await server.exec("dbt.compileFile", [fileUri(model)]);
  const p = e.result?.file_uri ? new URL(e.result.file_uri).pathname : undefined;
  return { ms: e.ms, text: p ? fs.readFileSync(p, "utf8") : null, result: e.result };
};
const before = await compiledText();
const original = fs.readFileSync(model, "utf8");
server.change(model, `${original}\n-- probe_unsaved_marker\n`);
await sleep(1500);
const unsaved = await compiledText();
out.compileFileReflectsUnsavedEdit = unsaved.text?.includes("probe_unsaved_marker") ?? null;
out.compileFileUnsavedResult = unsaved.result;
server.change(model, original);
for (const rel of ["models/schema.yml", "models/sources.yml", "seeds/raw_orders.csv", "macros/cents_to_dollars.sql", "tests/assert_positive_amount.sql", "models/staging/schema.yml"]) {
  const e = await server.exec("dbt.getCurrentNode", [rel]);
  out[`getCurrentNode ${rel}`] = { unique_id: e.result?.node?.unique_id ?? null, columns: Object.keys(e.result?.node?.columns ?? {}).length, error: e.result?.error ?? null };
}
const introspect = await server.exec("dbt.show", [{ inline: "select '{{ tojson(adapter.get_columns_in_relation(source('raw', 'raw_orders')) | map(attribute='name') | list) }}' as cols", limit: 1 }]);
out.showAdapterIntrospection = { ms: introspect.ms, result: introspect.result };
const introspectTypes = await server.exec("dbt.show", [{ inline: "{% set cols = adapter.get_columns_in_relation(source('raw', 'raw_orders')) %}select {% for c in cols %}'{{ c.name }}:{{ c.dtype }}' as c{{ loop.index }}{{ ',' if not loop.last }}{% endfor %}", limit: 1 }]);
out.showAdapterIntrospectionTypes = { ms: introspectTypes.ms, result: introspectTypes.result };
const zeroRows = await server.exec("dbt.show", [{ inline: "select * from {{ source('raw', 'raw_orders') }}", limit: 0 }]);
out.showLimit0 = { ms: zeroRows.ms, result: zeroRows.result };
const whole = await server.exec("dbt.listNodes", ["package:jaffle_shop"]);
const nodes = whole.result?.nodes ?? [];
const children = {};
for (const n of nodes) for (const p of n.depends_on?.nodes ?? []) (children[p] ??= []).push(n.unique_id);
out.wholeGraph = { ms: whole.ms, nodes: nodes.length, byType: nodes.reduce((a, n) => ((a[n.resource_type] = (a[n.resource_type] ?? 0) + 1), a), {}),
  childCountOrders: children["model.jaffle_shop.orders"]?.length ?? 0, nodeKeys: [...new Set(nodes.flatMap((n) => Object.keys(n)))].sort() };
out.clearTarget = (await server.exec("dbt.clearTarget", [])).result ?? null;
out.targetLspAfterClearTarget = fs.existsSync(path.join(root, "target/.lsp")) ? fs.readdirSync(path.join(root, "target/.lsp")).sort() : [];
writeJson(outFile, redact(out));
console.log(JSON.stringify(redact(out), null, 1).slice(0, 4000));
await server.stop();
process.exit(0);
