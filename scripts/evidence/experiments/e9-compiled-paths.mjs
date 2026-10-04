// E9, compiled paths under `fusionPowerUser.lsp.compiledOutput: shared`. Decision rule (fixed before running): run
// `separate` (DBT_LSP_USE_TARGET_LSP=1) and `shared` (the variable removed, as `toLspLaunch` does), each on a fresh
// copy. In each, record `compileFile`'s `file_uri` and the CTE lens `compiled_path`, then save an edit that adds a
// marker and record both again. A mode passes when both paths exist, hold compiled SQL (no Jinja delimiters) and show
// the marker after the save. If both modes pass, 2.7 and 2.9 use the returned paths verbatim; otherwise 2.7 removes
// the `shared` value with a release note.
import fs from "node:fs";
import path from "node:path";
import { prepareJaffle, scratch, setup } from "./adoption.mjs";

const ctx = await setup("e9-compiled-paths", { targets: ["jaffle"] });
const { lib } = ctx;
const rel = "models/orders.sql";
const marker = "fpu_e9_saved_marker";

const inspect = (p) => {
  const exists = Boolean(p && fs.existsSync(p));
  const text = exists ? fs.readFileSync(p, "utf8") : "";
  return {
    exists,
    compiled: exists && !/\{\{|\{%/.test(text),
    marker: text.includes(marker),
    bytes: text.length,
  };
};
async function paths(server, file) {
  const c = await server.exec("dbt.compileFile", [lib.fileUri(file)]);
  const lenses = await server.request("textDocument/codeLens", {
    textDocument: { uri: lib.fileUri(file) },
  });
  const compileFilePath = c.result?.file_uri
    ? new URL(c.result.file_uri).pathname
    : null;
  const lensPath =
    lenses.result?.[0]?.command?.arguments?.[1]?.compiled_path ?? null;
  return {
    compileFile: { path: compileFilePath, ...inspect(compileFilePath) },
    lens: { path: lensPath, ...inspect(lensPath) },
  };
}

async function run(mode) {
  const root =
    mode === "separate"
      ? ctx.root
      : prepareJaffle(path.join(scratch, "e9-compiled-paths-shared"), ctx.dbt);
  const env =
    mode === "separate"
      ? { DBT_LSP_USE_TARGET_LSP: "1" }
      : { DBT_LSP_USE_TARGET_LSP: undefined };
  const server = await ctx.start({ root, profilesDir: root, env });
  const file = path.join(root, rel);
  await ctx.load(server, rel);
  await lib.sleep(1000);
  const before = await paths(server, file);
  const text = fs
    .readFileSync(file, "utf8")
    .replace("select * from final", `select *, 1 as ${marker} from final`);
  fs.writeFileSync(file, text);
  const n = server.count("dbt/lspCompileComplete");
  server.change(file, text);
  server.save(file);
  await server.nextEvent("dbt/lspCompileComplete", n, 60000);
  await lib.sleep(1500);
  const after = await paths(server, file);
  const targetLsp = fs.existsSync(path.join(root, "target/.lsp"));
  await server.stop();
  const ok = (r) => r.exists && r.compiled;
  const passes =
    ok(before.compileFile) &&
    ok(before.lens) &&
    ok(after.compileFile) &&
    ok(after.lens) &&
    after.compileFile.marker &&
    after.lens.marker;
  const redactPath = (r) => ({
    ...r,
    path: r.path?.replace(root, "<P>") ?? null,
  });
  const redactPaths = (s) => ({
    compileFile: redactPath(s.compileFile),
    lens: redactPath(s.lens),
  });
  return {
    before: redactPaths(before),
    after: redactPaths(after),
    targetLspExists: targetLsp,
    passes,
  };
}

const separate = await run("separate");
const shared = await run("shared");
const decision =
  separate.passes && shared.passes
    ? "both modes pass: 2.7 and 2.9 read the returned paths verbatim"
    : `${[separate.passes ? "" : "separate", shared.passes ? "" : "shared"].filter(Boolean).join(" and ")} fails: ` +
      "2.7 removes the shared value of fusionPowerUser.lsp.compiledOutput with a release note";
const file = ctx.write({ rule: "see header", separate, shared, decision });
ctx.decide(
  `${decision}; shared paths ${shared.after.compileFile.path}, ${shared.after.lens.path} -> ${file}`,
);
process.exit(0);
