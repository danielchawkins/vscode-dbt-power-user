// E3, compiled SQL of unsaved text through the server. Decision rule (fixed before running): send `didChange` with
// a marker, then (a) `dbt.compileFile` and read its `file_uri`, and (b) `dbt.show` with the buffer as `inline`
// wrapped in a query that returns no rows, and look for compiled text in its answer. If neither returns compiled text
// for the buffer, D5 stands.
import fs from "node:fs";
import path from "node:path";
import { setup } from "./adoption.mjs";

const ctx = await setup("e3-unsaved-compile");
const { lib, root } = ctx;
const rel = ctx.config.files.model;
const model = path.join(root, rel);
const original = fs.readFileSync(model, "utf8");
const marker = "fpu_e3_unsaved_marker";
const server = await ctx.start();
await ctx.load(server, rel);
await lib.sleep(1000);

const readCompiled = (result) => {
  const p = result?.file_uri ? new URL(result.file_uri).pathname : undefined;
  return p && fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
};
const before = await server.exec("dbt.compileFile", [lib.fileUri(model)]);
const edited = `select probe_wrapped.*, 1 as ${marker} from (\n${original}\n) as probe_wrapped\n`;
server.change(model, edited);
await lib.sleep(3000);
const compileAfterChange = await server.exec("dbt.compileFile", [
  lib.fileUri(model),
]);
const compiledText = readCompiled(compileAfterChange.result);
const compileReflects = compiledText?.includes(marker) ?? false;
const compileHasJinja = compiledText ? /\{\{|\{%/.test(compiledText) : null;

// `limit: 0` keeps warehouse rows out; the answer carries columns and any compiled text the server returns.
const inline = await server.exec("dbt.show", [{ inline: edited, limit: 0 }], {
  timeoutMs: 300000,
});
const inlineText = JSON.stringify(inline.result ?? inline.error ?? null);
const inlineHasCompiled =
  /\bselect\b/i.test(inlineText) && !inlineText.includes("{{");
const inlineColumns = inline.result?.columns ?? null;
const inlineSeesMarker =
  inlineColumns?.map((c) => c.toLowerCase()).includes(marker) ?? false;
const showWithUri = await server.exec(
  "dbt.show",
  [{ uri: lib.fileUri(model), limit: 0 }],
  { timeoutMs: 300000 },
);
const uriSeesMarker =
  showWithUri.result?.columns?.map((c) => c.toLowerCase()).includes(marker) ??
  false;
server.change(model, original);
await server.stop();

const anyCompiled = compileReflects || inlineHasCompiled;
const decision = anyCompiled
  ? `the server returns compiled text for the buffer (${compileReflects ? "compileFile" : "show inline"}); E3 replaces D5`
  : "neither compileFile nor an inline show returns compiled text for the buffer: D5 stands";
const file = ctx.write({
  rule: "compiled text of the unsaved buffer from compileFile or an inline show; else D5 stands",
  before: { ms: before.ms, result: before.result },
  compileFileAfterChange: {
    ms: compileAfterChange.ms,
    result: compileAfterChange.result,
    reflectsUnsaved: compileReflects,
    hasJinja: compileHasJinja,
  },
  showInline: {
    ms: inline.ms,
    keys: Object.keys(inline.result ?? {}),
    columns: inlineColumns,
    error: inline.result?.error ?? inline.error ?? null,
    returnsCompiledText: inlineHasCompiled,
    columnsReflectUnsaved: inlineSeesMarker,
  },
  showUri: {
    ms: showWithUri.ms,
    columns: showWithUri.result?.columns ?? null,
    error: showWithUri.result?.error ?? null,
    columnsReflectUnsaved: uriSeesMarker,
  },
  decision,
});
ctx.decide(
  `${decision}; inline show runs the buffer: ${inlineSeesMarker} -> ${file}`,
);
process.exit(0);
