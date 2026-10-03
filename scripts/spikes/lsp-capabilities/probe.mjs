// Fusion 2.0.6 language-server capability probe. Usage:
//   node probe.mjs <config> <outDir>      config: jaffle | finance (see configs.mjs)
// Writes <outDir>/initialize.json, requests.json (every request, redacted and truncated), notifications.json
// (method counts and first params of each), and summary.json (one row per probe with ok/latency/shape).
import fs from "node:fs";
import path from "node:path";
import { configs } from "./configs.mjs";
import {
  decodeTokens, fileUri, percentile, positionOf, redactor, sleep, startServer, summarize, writeJson,
} from "./lib.mjs";

const [configName, outArg] = process.argv.slice(2);
const cfg = configs[configName];
if (!cfg) throw new Error(`unknown config ${configName}`);
const outDir = path.resolve(outArg);
// Fusion matches document URIs against the canonical project dir, so a symlinked root (macOS /tmp) loads nothing.
const root = fs.realpathSync(cfg.root);
const abs = (rel) => path.join(root, rel);
const redact = redactor(root);
const rows = [];

const truncate = (v, depth = 0) => {
  if (Array.isArray(v)) {
    const head = v.slice(0, 25).map((x) => truncate(x, depth + 1));
    return v.length > 25 ? [...head, { _truncated: v.length - 25 }] : head;
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, truncate(x, depth + 1)]));
  }
  if (typeof v === "string" && v.length > 4000) return `${v.slice(0, 4000)}…(${v.length} chars)`;
  return v;
};

/** Shape of a result: null, error, or a short description of what came back. */
const shape = (entry) => {
  if (entry.error) return entry.error.timeout ? `timeout ${entry.error.timeout} ms` : `error ${entry.error.code}: ${entry.error.message}`;
  const r = entry.result;
  if (r === null || r === undefined) return "null";
  if (Array.isArray(r)) return `array(${r.length})`;
  if (typeof r === "object") {
    const keys = Object.keys(r);
    const parts = keys.map((k) => {
      const x = r[k];
      if (Array.isArray(x)) return `${k}[${x.length}]`;
      if (x === null) return `${k}:null`;
      if (typeof x === "object") return `${k}{${Object.keys(x).length}}`;
      return `${k}:${String(x).slice(0, 80)}`;
    });
    return `{${parts.join(", ")}}`;
  }
  return String(r).slice(0, 120);
};

const useful = (entry) => {
  if (entry.error) return false;
  const r = entry.result;
  if (r === null || r === undefined) return false;
  if (Array.isArray(r)) return r.length > 0;
  if (typeof r === "object") {
    if (typeof r.error === "string" && r.error) return false;
    if (Array.isArray(r.nodes)) return r.nodes.length > 0;
    if ("contents" in r) return Boolean(r.contents && (r.contents.value ?? r.contents.length ?? true));
    if (Array.isArray(r.items)) return r.items.length > 0;
    if (Array.isArray(r.data)) return r.data.length > 0 || Array.isArray(r.columns);
    if ("changes" in r || "documentChanges" in r) return Object.keys(r.changes ?? {}).length > 0 || (r.documentChanges ?? []).length > 0;
    return Object.keys(r).length > 0;
  }
  return true;
};

const record = (group, name, entry, extra = {}) => {
  const row = { group, name, method: entry.method, params: redact(entry.params), ok: useful(entry), ms: entry.ms,
    shape: redact(shape(entry)), ...extra };
  rows.push(row);
  console.log(`${row.ok ? "OK  " : "--  "}${group} ${name} ${entry.ms}ms ${row.shape.slice(0, 160)}`);
  return entry;
};

/** Runs `fn` `n` times and stores p50; `fn` returns a request entry. */
const bench = async (group, name, fn, n = 5) => {
  const entries = [];
  for (let i = 0; i < n; i++) entries.push(await fn());
  const ms = entries.map((e) => e.ms);
  const last = entries[entries.length - 1];
  return record(group, name, last, { p50: percentile(ms, 50), samples: ms });
};

const startedAt = Date.now();
const server = await startServer({ root, profilesDir: cfg.profilesDir ?? root, extraArgs: cfg.lspArgs, env: cfg.env });
writeJson(path.join(outDir, "initialize.json"), redact({ argv: server.args, response: server.init.result ?? server.init.error, ms: server.init.ms }));
const caps = server.init.result?.capabilities ?? {};

// ---------- load ----------
const firstFile = abs(cfg.files.model);
const tOpen = Date.now();
server.openDoc(firstFile);
const compileComplete = await server.waitNotification("dbt/lspCompileComplete", { timeoutMs: cfg.loadTimeoutMs ?? 300000 });
const tCompile = Date.now() - tOpen;
const bgComplete = await server.waitNotification("dbt/lspBackgroundCompileComplete", { timeoutMs: cfg.loadTimeoutMs ?? 300000 });
const tBackground = Date.now() - tOpen;
const info = await server.exec("dbt.getProjectInfo", []);
record("load", "getProjectInfo after background compile", info);
const load = redact({
  spawnToInitializeMs: server.init.ms,
  didOpenToCompileCompleteMs: compileComplete.timeout ? null : tCompile,
  didOpenToBackgroundCompleteMs: bgComplete.timeout ? null : tBackground,
  compileComplete: truncate(compileComplete.params ?? compileComplete),
  backgroundComplete: truncate(bgComplete.params ?? bgComplete),
});
writeJson(path.join(outDir, "load.json"), load);
console.log("load", JSON.stringify({ tCompile, tBackground }));
for (const rel of cfg.files.openAlso ?? []) server.openDoc(abs(rel));
await sleep(1500);
const cleanLenses = await bench("lsp", "codeLens (clean document, after load)", () => server.request("textDocument/codeLens", { textDocument: { uri: fileUri(abs(cfg.files.cteModel ?? cfg.files.model)) } }), cfg.samples ?? 5);
rows[rows.length - 1].detail = redact((cleanLenses.result ?? []).map((l) => ({ title: l.command?.title, command: l.command?.command, name: l.command?.arguments?.[1]?.name, line: l.range?.start?.line })));
writeJson(path.join(outDir, "codeLens.json"), redact(cleanLenses.result));
{
  const legend0 = caps.semanticTokensProvider?.legend;
  const m = abs(cfg.files.model);
  const clean = await bench("lsp", "semanticTokens/full (clean document)", () => server.request("textDocument/semanticTokens/full", { textDocument: { uri: fileUri(m) } }), cfg.samples ?? 5);
  if (clean.result?.data && legend0) {
    const decoded = decodeTokens(clean.result.data, legend0, fs.readFileSync(m, "utf8"));
    const byType = {};
    for (const t of decoded) (byType[t.type] ??= new Set()).add(t.text);
    rows[rows.length - 1].detail = redact({ legend: legend0, count: decoded.length, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, [...v].slice(0, 20)])) });
  }
  await bench("lsp", "inlayHint (clean document)", () => server.request("textDocument/inlayHint", { textDocument: { uri: fileUri(m) }, range: { start: { line: 0, character: 0 }, end: { line: 200, character: 0 } } }), cfg.samples ?? 5);
  // The same document after an unsaved edit that leaves the text identical plus one trailing newline.
  const text = fs.readFileSync(m, "utf8");
  server.change(m, `${text}\n`);
  await sleep(1000);
  await bench("lsp", "codeLens (after unsaved didChange)", () => server.request("textDocument/codeLens", { textDocument: { uri: fileUri(m) } }), cfg.samples ?? 5);
  await bench("lsp", "semanticTokens/full (after unsaved didChange)", () => server.request("textDocument/semanticTokens/full", { textDocument: { uri: fileUri(m) } }), cfg.samples ?? 5);
  server.change(m, text);
  server.save(m);
  await sleep(2000);
  await bench("lsp", "codeLens (after didSave of original text)", () => server.request("textDocument/codeLens", { textDocument: { uri: fileUri(m) } }), cfg.samples ?? 5);
  await bench("lsp", "semanticTokens/full (after didSave of original text)", () => server.request("textDocument/semanticTokens/full", { textDocument: { uri: fileUri(m) } }), cfg.samples ?? 5);
}

// ---------- standard LSP ----------
const td = (rel) => ({ textDocument: { uri: fileUri(abs(rel)) } });
const at = (rel, find, offset = 0) => positionOf(abs(rel), find, offset);
const std = async (name, method, params, opts) => bench("lsp", name, () => server.request(method, params, opts), cfg.samples ?? 5);

for (const [name, spec] of Object.entries(cfg.positions)) {
  const p = at(spec.file, spec.find, spec.offset ?? 0);
  if (spec.hover !== false) await std(`hover ${name}`, "textDocument/hover", p);
  if (spec.definition !== false) await std(`definition ${name}`, "textDocument/definition", p);
  if (spec.references) await std(`references ${name}`, "textDocument/references", { ...p, context: { includeDeclaration: true } });
  if (spec.signature) await std(`signatureHelp ${name}`, "textDocument/signatureHelp", p);
  if (spec.rename) {
    await std(`prepareRename ${name}`, "textDocument/prepareRename", p);
    await std(`rename ${name}`, "textDocument/rename", { ...p, newName: `${spec.find.replace(/\W/g, "")}_renamed` });
  }
}

// Completion: write the trigger text into the open document (unsaved) and ask at its end.
for (const [name, spec] of Object.entries(cfg.completions)) {
  const file = abs(spec.file);
  const original = fs.readFileSync(file, "utf8");
  const text = original + "\n" + spec.append;
  const lines = text.split("\n");
  server.change(file, text);
  await sleep(300);
  const entry = await bench("lsp", `completion ${name}`, () => server.request("textDocument/completion", {
    textDocument: { uri: fileUri(file) },
    position: { line: lines.length - 1, character: lines[lines.length - 1].length },
    context: { triggerKind: spec.trigger ? 2 : 1, ...(spec.trigger ? { triggerCharacter: spec.trigger } : {}) },
  }), cfg.samples ?? 5);
  const items = entry.result?.items ?? entry.result ?? [];
  const kinds = {};
  for (const item of Array.isArray(items) ? items : []) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
  rows[rows.length - 1].detail = redact({ count: items.length, kinds, sample: (Array.isArray(items) ? items : []).slice(0, 8).map((i) => ({ label: i.label, kind: i.kind, detail: i.detail, insertText: i.insertText })) });
  server.change(file, original);
  await sleep(300);
}

const model = cfg.files.model;
await std("documentSymbol", "textDocument/documentSymbol", td(model));
await std("workspaceSymbol", "workspace/symbol", { query: cfg.symbolQuery });
const lenses = await std("codeLens", "textDocument/codeLens", td(cfg.files.cteModel ?? model));
const lensCommands = (lenses.result ?? []).map((l) => l.command);
rows[rows.length - 1].detail = redact(lensCommands);
for (const rel of cfg.files.lensAlso ?? []) {
  const e = await std(`codeLens ${rel}`, "textDocument/codeLens", td(rel));
  rows[rows.length - 1].detail = redact((e.result ?? []).map((l) => l.command));
}
await std("codeAction", "textDocument/codeAction", { ...td(model), range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } }, context: { diagnostics: [], only: ["source.fixAll"] } });
await std("codeAction (no filter)", "textDocument/codeAction", { ...td(model), range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } }, context: { diagnostics: [] } });
await std("formatting", "textDocument/formatting", { ...td(model), options: { tabSize: 4, insertSpaces: true } });
await std("rangeFormatting", "textDocument/rangeFormatting", { ...td(model), range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } }, options: { tabSize: 4, insertSpaces: true } });
const legend = caps.semanticTokensProvider?.legend;
const tokens = await std("semanticTokens/full", "textDocument/semanticTokens/full", td(model));
if (tokens.result?.data && legend) {
  const decoded = decodeTokens(tokens.result.data, legend, fs.readFileSync(abs(model), "utf8"));
  const byType = {};
  for (const t of decoded) (byType[t.type] ??= new Set()).add(t.text);
  rows[rows.length - 1].detail = redact({ legend, count: decoded.length, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, [...v].slice(0, 20)])) });
}
await std("semanticTokens/range", "textDocument/semanticTokens/range", { ...td(model), range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } });
await std("semanticTokens/full/delta", "textDocument/semanticTokens/full/delta", { ...td(model), previousResultId: tokens.result?.resultId ?? "0" });
await std("inlayHint", "textDocument/inlayHint", { ...td(model), range: { start: { line: 0, character: 0 }, end: { line: 200, character: 0 } } });
await std("foldingRange", "textDocument/foldingRange", td(model));
await std("documentLink", "textDocument/documentLink", td(model));
await std("documentHighlight", "textDocument/documentHighlight", at(model, cfg.positions[Object.keys(cfg.positions)[0]].find));
await std("diagnostic (pull)", "textDocument/diagnostic", td(model));
await std("workspace/diagnostic (pull)", "workspace/diagnostic", { previousResultIds: [] });
await std("willRenameFiles", "workspace/willRenameFiles", { files: [{ oldUri: fileUri(abs(model)), newUri: fileUri(abs(model).replace(/\.sql$/, "_moved.sql")) }] });

// ---------- dbt.* commands ----------
const cmd = (name, command, args, opts) => bench("dbt", name, () => server.exec(command, args, opts), cfg.samples ?? 5);
const once = async (name, command, args, opts) => record("dbt", name, await server.exec(command, args, opts));
const uid = cfg.uniqueId;
const name = uid.split(".").pop();
await cmd("getProjectInfo []", "dbt.getProjectInfo", []);
const selectors = {
  "bare relpath": model,
  "name": name,
  "unique_id": uid,
  "+name+": `+${name}+`,
  "name+": `${name}+`,
  "+name": `+${name}`,
  "1+name+1": `1+${name}+1`,
  "2+name+2": `2+${name}+2`,
  "+unique_id+": `+${uid}+`,
  "@unique_id": `@${uid}`,
  "+relpath+": `+${model}+`,
  "path:dir": `path:${path.dirname(model)}`,
  "dir": path.dirname(model),
  "tag": cfg.tag,
  "resource_type:source": "resource_type:source",
  "source:*": "source:*",
  "*": "*",
  "seed": cfg.seedSelector,
  "+column:uid.col+": `+column:${uid}.${cfg.column}+`,
  "column:uid.col+": `column:${uid}.${cfg.column}+`,
  "+column:uid.col": `+column:${uid}.${cfg.column}`,
  "1+column:uid.col+1": `1+column:${uid}.${cfg.column}+1`,
  "intersection a,b": `${name},+${name}`,
  "union 'a b'": `${name} ${cfg.otherModelName}`,
  "exposure": cfg.exposureSelector,
  "test_type:unit": "test_type:unit",
  "test_type:generic": "test_type:generic",
  "resource_type:test": "resource_type:test",
  "resource_type:macro": "resource_type:macro",
  "resource_type:doc": "resource_type:doc",
  "resource_type:model": "resource_type:model",
  "state:modified": "state:modified",
  "package:root": `package:${uid.split(".")[1]}`,
};
const listNodesResults = {};
for (const [label, selector] of Object.entries(selectors)) {
  if (!selector) continue;
  const e = await cmd(`listNodes [${label}]`, "dbt.listNodes", [selector]);
  listNodesResults[label] = e.result;
  if (e.result?.nodes) rows[rows.length - 1].detail = { nodes: e.result.nodes.length, grain: e.result.grain, ids: redact(e.result.nodes.slice(0, 12).map((n) => n.unique_id ?? n.id ?? n.name)) };
}
await cmd("listNodes [@uid, +column:uid.col+] (official)", "dbt.listNodes", [`@${uid}`, `+column:${uid}.${cfg.column}+`]);
for (const args of cfg.columnProbes ?? []) {
  const e = await cmd(`listNodes ${JSON.stringify(args)}`, "dbt.listNodes", args);
  listNodesResults[JSON.stringify(args)] = e.result;
  if (e.result?.nodes) rows[rows.length - 1].detail = { nodes: e.result.nodes.length, grain: e.result.grain };
}
await once("listNodes [{selector,depth}]", "dbt.listNodes", [{ selector: `+${name}+`, depth: 1 }]);
await once("listNodes [selector, {depth:1}]", "dbt.listNodes", [`+${name}+`, { depth: 1 }]);
writeJson(path.join(outDir, "listNodes.json"), redact(truncate(listNodesResults)));

const cur = await cmd("getCurrentNode [relpath]", "dbt.getCurrentNode", [model]);
writeJson(path.join(outDir, "getCurrentNode.json"), redact(truncate(cur.result)));
for (const rel of cfg.files.currentNodeAlso ?? []) await once(`getCurrentNode [${rel}]`, "dbt.getCurrentNode", [rel]);
await once("getCurrentNode [uri]", "dbt.getCurrentNode", [fileUri(abs(model))]);
await once("getCurrentNode [unique_id]", "dbt.getCurrentNode", [uid]);

const compiled = await cmd("compileFile [uri]", "dbt.compileFile", [fileUri(abs(model))]);
const compiledPath = compiled.result?.file_uri ? new URL(compiled.result.file_uri).pathname : undefined;
if (compiledPath && fs.existsSync(compiledPath)) {
  rows[rows.length - 1].detail = { compiledBytes: fs.statSync(compiledPath).size, head: redact(fs.readFileSync(compiledPath, "utf8").slice(0, 300)) };
}
await once("compileFile [relpath]", "dbt.compileFile", [model]);
await once("compileFile [{uri}]", "dbt.compileFile", [{ uri: fileUri(abs(model)) }]);
await once("compileLsp []", "dbt.compileLsp", []);
await once("compileLsp [uri]", "dbt.compileLsp", [fileUri(abs(model))]);

const showUri = await cmd("show [{uri}]", "dbt.show", [{ uri: fileUri(abs(model)) }]);
writeJson(path.join(outDir, "show-uri.json"), redact(truncate(showUri.result)));
await cmd("show [{uri,limit:10}]", "dbt.show", [{ uri: fileUri(abs(model)), limit: 10 }]);
await cmd("show [{inline,limit:10}]", "dbt.show", [{ inline: cfg.showInline, limit: 10 }]);
const showTyped = await once("show [{inline: typed literals}]", "dbt.show", [{ inline: "select 1 as i, 1.5 as d, 'x' as s, true as b, current_date as dt, null as n", limit: 1 }]);
writeJson(path.join(outDir, "show-typed.json"), redact(showTyped.result));
await once("show [{uri,inline,limit:3}]", "dbt.show", [{ uri: fileUri(abs(model)), inline: cfg.showInline, limit: 3 }]);
await once("show [{uri, limit:-1}]", "dbt.show", [{ uri: fileUri(abs(model)), limit: -1 }]);
await once("show [{inline: bad sql}]", "dbt.show", [{ inline: "select from where", limit: 1 }]);
await once("show [{inline: unknown ref}]", "dbt.show", [{ inline: "select * from {{ ref('no_such_model') }}", limit: 1 }]);

// CTE preview: Fusion's lens names `dbt.previewCte`, a client command; its argument carries compiled offsets.
const cteLens = (cleanLenses.result ?? []).map((l) => l.command).find((c) => c?.command === "dbt.previewCte");
if (cteLens) {
  await once("previewCte [lens arguments] as executeCommand", "dbt.previewCte", cteLens.arguments ?? []);
  const [, cte] = cteLens.arguments;
  const compiledText = fs.readFileSync(cte.compiled_path, "utf8");
  // [compiled_start, compiled_stop) runs from `with` to the end of the CTE body, before its closing parenthesis.
  const prefix = compiledText.slice(cte.compiled_start, cte.compiled_stop);
  const inline = `${prefix}\n)\nselect * from ${cte.name}`;
  const e = await cmd(`show [{inline: compiled[start..stop] + ) select * from ${cte.name}}]`, "dbt.show", [{ inline, limit: 10 }]);
  rows[rows.length - 1].detail = redact({ prefixHead: prefix.slice(0, 120), prefixTail: prefix.slice(-80), columns: e.result?.columns, rows: e.result?.data?.length, error: e.result?.error });
}
await once("previewCte [{uri, cte}]", "dbt.previewCte", [{ uri: fileUri(abs(cfg.files.cteModel ?? model)), cte_name: cfg.cteName }]);
await once("goToDefinition [{uri,line,character}]", "dbt.goToDefinition", [{ uri: fileUri(abs(model)), line: 0, character: 0 }]);
await once("doesNotExist []", "dbt.doesNotExist", []);

// ---------- freshness: disk-only edit of a closed file, didChange, didSave, didChangeWatchedFiles ----------
const fresh = {};
if (cfg.freshness) {
  const { file, closedFile, append, column } = cfg.freshness;
  // Snowflake reports unquoted identifiers in upper case.
  const rawCols = async (rel) => Object.keys((await server.exec("dbt.getCurrentNode", [rel])).result?.node?.columns ?? {});
  const colsOf = async (rel) => (await rawCols(rel)).map((c) => c.toLowerCase());
  const compiles = () => server.count("dbt/lspCompileComplete");
  const restore = [];
  try {
    // A: a file no document is open for, edited on disk with no notification at all.
    const closed = abs(closedFile);
    const closedOriginal = fs.readFileSync(closed, "utf8");
    restore.push([closed, closedOriginal]);
    fresh.closedBefore = (await colsOf(closedFile)).includes(column);
    let c0 = compiles();
    const logs0 = server.events.length;
    fs.writeFileSync(closed, append(closedOriginal));
    await sleep(8000);
    fresh.closedDiskEditCompilesSeen = compiles() - c0;
    fresh.closedDiskEditReflected = (await colsOf(closedFile)).includes(column);
    fresh.closedDiskEditServerLog = redact(server.events.slice(logs0).filter((e) => e.method === "window/logMessage").map((e) => e.params.message.slice(0, 160)).slice(0, 12));
    // B: the same file announced with didChangeWatchedFiles (Changed), as a client honouring the registration does.
    c0 = compiles();
    server.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: fileUri(closed), type: 2 }] });
    const w = await server.nextEvent("dbt/lspCompileComplete", c0, 60000);
    fresh.watchedChangeToCompileMs = w.waitedMs ?? null;
    fresh.watchedChangeReflected = (await colsOf(closedFile)).includes(column);
    // C: an open document, unsaved didChange.
    const open = abs(file);
    const openOriginal = fs.readFileSync(open, "utf8");
    restore.push([open, openOriginal]);
    fresh.openBefore = (await colsOf(file)).includes(column);
    c0 = compiles();
    server.change(open, append(openOriginal));
    await sleep(4000);
    fresh.didChangeCompilesSeen = compiles() - c0;
    fresh.didChangeReflected = (await colsOf(file)).includes(column);
    // D: write and didSave.
    fs.writeFileSync(open, append(openOriginal));
    c0 = compiles();
    const tSave = Date.now();
    server.save(open);
    const s = await server.nextEvent("dbt/lspCompileComplete", c0, 120000);
    fresh.didSaveToCompileCompleteMs = s.timeout ? null : Date.now() - tSave;
    fresh.didSaveReflected = (await colsOf(file)).includes(column);
    fresh.didSaveCompileErrors = redact((s.params?.errors ?? []).filter((x) => x.message.includes(path.basename(file))).map((x) => x.message.slice(0, 300)));
    const editedId = `${cfg.uniqueId.replace(/\.[^.]+$/, "")}.${path.basename(file, ".sql")}`;
    const spelled = (await rawCols(file)).find((c) => c.toLowerCase() === column) ?? column;
    const child = await server.exec("dbt.listNodes", [`@${editedId}`, `+column:${editedId}.${spelled}+`]);
    fresh.didSaveColumnLineageNodes = child.result?.nodes?.length ?? null;
    // E: a new model file, announced only by didChangeWatchedFiles (Created).
    const newRel = path.join(path.dirname(file), "zz_probe_new.sql");
    fs.writeFileSync(abs(newRel), cfg.freshness.newModelSql);
    restore.push([abs(newRel), null]);
    c0 = compiles();
    server.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: fileUri(abs(newRel)), type: 1 }] });
    const n = await server.nextEvent("dbt/lspCompileComplete", c0, 60000);
    fresh.createdToCompileMs = n.waitedMs ?? null;
    fresh.createdListed = ((await server.exec("dbt.listNodes", ["zz_probe_new"])).result?.nodes ?? []).length > 0;
    const manifestPath = abs("target/manifest.json");
    fresh.serverWroteTargetManifest = fs.existsSync(manifestPath) && fs.statSync(manifestPath).mtimeMs > startedAt;
    fresh.lspTargetEntries = fs.existsSync(abs("target/.lsp")) ? fs.readdirSync(abs("target/.lsp")).sort() : [];
    fresh.lspManifestFiles = fs.existsSync(abs("target/.lsp")) ? fs.readdirSync(abs("target/.lsp"), { recursive: true }).filter((f) => /manifest|catalog|run_results/.test(f)) : [];
  } finally {
    for (const [p, text] of restore.reverse()) {
      if (text === null) {
        fs.rmSync(p, { force: true });
        server.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: fileUri(p), type: 3 }] });
      } else {
        fs.writeFileSync(p, text);
        if (p === abs(file)) { server.change(p, text); server.save(p); }
        else server.notify("workspace/didChangeWatchedFiles", { changes: [{ uri: fileUri(p), type: 2 }] });
      }
    }
    await sleep(3000);
  }
  writeJson(path.join(outDir, "freshness.json"), fresh);
  console.log("freshness", JSON.stringify(fresh));
}

// ---------- diagnostics ----------
const diag = {};
if (cfg.diagnostics) {
  const target = abs(cfg.diagnostics.file);
  const original = fs.readFileSync(target, "utf8");
  for (const [label, mutate] of Object.entries(cfg.diagnostics.cases)) {
    const n0 = server.events.length;
    const c0 = server.count("dbt/lspCompileComplete");
    fs.writeFileSync(target, mutate(original));
    server.change(target, mutate(original));
    server.save(target);
    const done = await server.nextEvent("dbt/lspCompileComplete", c0, 60000);
    await sleep(1500);
    const pushed = server.events.slice(n0).filter((e) => e.method === "textDocument/publishDiagnostics" && e.params.uri === fileUri(target));
    diag[label] = redact({
      pushed: pushed.at(-1)?.params?.diagnostics?.map((d) => ({ severity: d.severity, code: d.code, source: d.source, message: d.message.slice(0, 300), range: d.range })),
      compileCompleteErrors: truncate(done.params?.errors),
    });
    const c1 = server.count("dbt/lspCompileComplete");
    fs.writeFileSync(target, original);
    server.change(target, original);
    server.save(target);
    await server.nextEvent("dbt/lspCompileComplete", c1, 60000);
  }
  writeJson(path.join(outDir, "diagnostics.json"), diag);
}

// ---------- concurrency ----------
const conc = await Promise.all([server.exec("dbt.listNodes", [`+${name}+`]), server.exec("dbt.listNodes", [`+${cfg.otherModelName}+`])]);
record("dbt", "listNodes concurrent #1", conc[0]);
record("dbt", "listNodes concurrent #2", conc[1]);
const concMixed = await Promise.all([server.exec("dbt.getCurrentNode", [model]), server.exec("dbt.show", [{ inline: cfg.showInline, limit: 1 }]), server.exec("dbt.compileFile", [fileUri(abs(model))])]);
concMixed.forEach((e, i) => record("dbt", `mixed concurrent #${i + 1} ${e.params.command}`, e));

// ---------- write ----------
const notifications = {};
for (const e of server.events) {
  const key = `${e.kind} ${e.method}`;
  notifications[key] ??= { count: 0, first: truncate(e.params) };
  notifications[key].count += 1;
}
writeJson(path.join(outDir, "notifications.json"), redact(notifications));
writeJson(path.join(outDir, "requests.json"), redact(server.requests.map((e) => truncate(e))));
writeJson(path.join(outDir, "summary.json"), rows);
await server.stop();
fs.writeFileSync(path.join(outDir, "stderr-tail.txt"), redact(server.stderr().slice(-4000)));
console.log(`wrote ${outDir}`);
process.exit(0);
