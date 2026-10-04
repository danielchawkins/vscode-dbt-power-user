// Stdio LSP client for the Fusion 2.0.6 capability spike. Records every request (params, result, latency) and every
// server notification and server request, redacting the project root, HOME and credential-like env values.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const rpc = require("vscode-jsonrpc/node");

export const DBT =
  process.env.DBT_BIN ?? "/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt";

const SECRET_ENV = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|ACCOUNT|USER|ROLE|WAREHOUSE/i;

/** Returns a function that replaces the project root, HOME and credential-like env values in any JSON value. */
export function redactor(root) {
  const pairs = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (SECRET_ENV.test(name) && value && value.length >= 4 && !/^(true|false|\d+)$/.test(value)) {
      pairs.push([value, `<${name}>`]);
    }
  }
  const real = fs.realpathSync(root);
  pairs.push([pathToFileURL(real).href, "file://<P>"], [real, "<P>"]);
  if (real !== root) pairs.push([pathToFileURL(root).href, "file://<P>"], [root, "<P>"]);
  pairs.push([os.homedir(), "~"]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (v) => {
    let s = JSON.stringify(v);
    if (s === undefined) return v;
    for (const [from, to] of pairs) s = s.split(JSON.stringify(from).slice(1, -1)).join(to);
    return JSON.parse(s);
  };
}

export const fileUri = (p) => pathToFileURL(p).href;

export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts `dbt lsp` over stdio on `root`. `extraArgs` follow the base argv; `env` is layered over process.env.
 * The client answers progress creation, configuration (linter off, as the extension does) and registration.
 */
export async function startServer({ root, profilesDir = root, extraArgs = [], env = {}, capabilities, commandPrefix = "" } = {}) {
  const args = [
    "lsp",
    "--project-dir", root,
    "--profiles-dir", profilesDir,
    "--lint-enabled", "false",
    "--no-version-check",
    "--command-prefix", commandPrefix,
    ...extraArgs,
  ];
  const t0 = Date.now();
  const child = spawn(DBT, args, {
    cwd: root,
    env: { ...process.env, DBT_LSP_USE_TARGET_LSP: "1", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20000)));
  const conn = rpc.createMessageConnection(
    new rpc.StreamMessageReader(child.stdout),
    new rpc.StreamMessageWriter(child.stdin),
  );
  const events = [];
  const at = () => Date.now() - t0;
  const progressTitles = new Map();
  const waiters = [];
  const push = (e) => {
    events.push(e);
    for (const w of [...waiters]) if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
  };
  conn.onNotification((method, params) => {
    if (method === "$/progress" && params?.value?.kind === "begin") {
      progressTitles.set(params.token, params.value.title || params.value.message);
    }
    push({ t: at(), kind: "notification", method, params,
      title: method === "$/progress" ? progressTitles.get(params?.token) : undefined });
  });
  conn.onRequest((method, params) => {
    push({ t: at(), kind: "serverRequest", method, params });
    if (method === "workspace/configuration") {
      return params.items.map((i) => (i.section === "dbt" ? { lsp: { linter: { enabled: false } } } : null));
    }
    return null;
  });
  conn.listen();

  const requests = [];
  /** Sends one request; resolves with {result} or {error} and its latency, never rejects. */
  const request = async (method, params, { timeoutMs = 60000, label } = {}) => {
    const start = Date.now();
    const entry = { label: label ?? method, method, params, t: at() };
    const tokenSource = new rpc.CancellationTokenSource();
    let timer;
    try {
      const result = await Promise.race([
        conn.sendRequest(method, params, tokenSource.token),
        new Promise((_, rej) => (timer = setTimeout(() => rej(Object.assign(new Error("timeout"), { timeout: true })), timeoutMs))),
      ]);
      entry.result = result;
    } catch (error) {
      if (error.timeout) tokenSource.cancel();
      entry.error = error.timeout ? { timeout: timeoutMs } : { code: error.code, message: error.message, data: error.data };
    } finally {
      clearTimeout(timer);
    }
    entry.ms = Date.now() - start;
    requests.push(entry);
    return entry;
  };
  const exec = (command, args, opts) =>
    request("workspace/executeCommand", { command, arguments: args }, { label: `${command} ${JSON.stringify(args)}`, ...opts });
  const notify = (method, params) => {
    push({ t: at(), kind: "clientNotification", method, params });
    return conn.sendNotification(method, params);
  };
  /** Resolves with the first event (past events count unless `fresh`) matching `test`, or {timeout}. */
  const waitFor = (test, { timeoutMs = 120000, fresh = false } = {}) => {
    if (!fresh) { const hit = events.find(test); if (hit) return Promise.resolve(hit); }
    return new Promise((resolve) => {
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); resolve({ timeout: timeoutMs }); } }, timeoutMs);
    });
  };
  const waitNotification = (method, opts) => waitFor((e) => e.kind === "notification" && e.method === method, opts);
  const waitProgressEnd = (title, opts) =>
    waitFor((e) => e.method === "$/progress" && e.params?.value?.kind === "end" && e.title === title, opts);

  let version = 1;
  const openDoc = (absPath, languageId = absPath.endsWith(".yml") ? "yaml" : "jinja-sql") =>
    notify("textDocument/didOpen", {
      textDocument: { uri: fileUri(absPath), languageId, version: version++, text: fs.readFileSync(absPath, "utf8") },
    });
  /** Replaces the whole open document with `text` (unsaved). */
  const change = (absPath, text) =>
    notify("textDocument/didChange", { textDocument: { uri: fileUri(absPath), version: version++ }, contentChanges: [{ text }] });
  const save = (absPath) => notify("textDocument/didSave", { textDocument: { uri: fileUri(absPath) } });
  /** Count of `method` events seen so far, for waiting on the next one. */
  const count = (method) => events.filter((e) => e.method === method).length;
  /** Resolves when the (n+1)th `method` event arrives, with its latency from now, or {timeout}. */
  const nextEvent = async (method, n, timeoutMs = 60000) => {
    const t = Date.now();
    const hit = await waitFor((e) => e.method === method && events.filter((x) => x.method === method).indexOf(e) >= n, { timeoutMs });
    return hit.timeout ? hit : { ...hit, waitedMs: Date.now() - t };
  };

  const init = await request("initialize", {
    processId: process.pid,
    rootUri: fileUri(root),
    workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
    capabilities: capabilities ?? defaultClientCapabilities,
    clientInfo: { name: "fpu-lsp-capabilities-spike", version: "0" },
  });
  notify("initialized", {});

  const stop = async () => {
    await Promise.race([conn.sendRequest("shutdown").catch(() => {}), sleep(5000)]);
    conn.sendNotification("exit");
    await sleep(500);
    child.kill();
    conn.dispose();
  };
  return { args, child, conn, init, request, exec, notify, waitFor, waitNotification, waitProgressEnd, openDoc,
    change, save, count, nextEvent,
    events, requests, stop, stderr: () => stderr, at };
}

/** The client capabilities vscode-languageclient 10 sends, reduced to the parts Fusion reads. */
export const defaultClientCapabilities = {
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    executeCommand: { dynamicRegistration: true },
    configuration: true,
    workspaceFolders: true,
    semanticTokens: { refreshSupport: true },
    codeLens: { refreshSupport: true },
    inlayHint: { refreshSupport: true },
    diagnostics: { refreshSupport: true },
    fileOperations: { willRename: true, didRename: true },
  },
  textDocument: {
    synchronization: { didSave: true, willSave: true },
    completion: { completionItem: { snippetSupport: true, labelDetailsSupport: true, documentationFormat: ["markdown", "plaintext"] }, contextSupport: true },
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: { signatureInformation: { documentationFormat: ["markdown", "plaintext"] } },
    definition: { linkSupport: true },
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["", "quickfix", "refactor", "source", "source.fixAll"] } } },
    codeLens: {},
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: true },
    publishDiagnostics: { relatedInformation: true, versionSupport: true },
    foldingRange: {},
    documentLink: {},
    semanticTokens: {
      requests: { full: { delta: true }, range: true },
      tokenTypes: ["namespace", "type", "class", "function", "macro", "keyword", "variable", "property", "parameter", "string", "number", "operator", "comment"],
      tokenModifiers: [],
      formats: ["relative"],
    },
    inlayHint: {},
    diagnostic: { relatedDocumentSupport: true },
  },
  window: { workDoneProgress: true, showMessage: {}, showDocument: { support: true } },
  general: { positionEncodings: ["utf-16"] },
};

/** `{textDocument, position}` for the first occurrence of `find` in `absPath`, shifted by `offset` characters. */
export function positionOf(absPath, find, offset = 0) {
  const lines = fs.readFileSync(absPath, "utf8").split("\n");
  const line = lines.findIndex((l) => l.includes(find));
  if (line < 0) throw new Error(`${find} not in ${absPath}`);
  return { textDocument: { uri: fileUri(absPath) }, position: { line, character: lines[line].indexOf(find) + offset } };
}

/** Decodes LSP relative semantic tokens into `{line, char, text, type}` rows. */
export function decodeTokens(data, legend, text) {
  const lines = text.split("\n");
  const out = [];
  let line = 0, char = 0;
  for (let i = 0; i + 4 < data.length + 1; i += 5) {
    line += data[i];
    char = data[i] === 0 ? char + data[i + 1] : data[i + 1];
    out.push({ line, char, text: lines[line]?.slice(char, char + data[i + 2]), type: legend.tokenTypes[data[i + 3]], mods: data[i + 4] });
  }
  return out;
}

export function summarize(value, max = 400) {
  const s = JSON.stringify(value);
  return s === undefined ? "undefined" : s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
