#!/usr/bin/env node
// Summarise one lsp-transcript.jsonl without dropping anything countable. Usage: node l-notes.mjs <transcript>
// Prints: count per server->client method, every $/progress token with its begin title and end message,
// publishDiagnostics per file (last diagnostic count and messages), and every window/showMessage|logMessage text.
import fs from "node:fs";
import path from "node:path";

const lines = fs.readFileSync(process.argv[2], "utf8").trim().split("\n");
const methods = {};
const progress = new Map();
const diags = new Map();
const messages = [];
for (const line of lines) {
  const { t, dir, msg } = JSON.parse(line);
  if (dir !== "server->client" || !msg.method) continue;
  methods[msg.method] = (methods[msg.method] ?? 0) + 1;
  const p = msg.params ?? {};
  if (msg.method === "$/progress") {
    const e = progress.get(p.token) ?? { token: p.token };
    const v = p.value ?? {};
    if (v.kind === "begin") Object.assign(e, { title: v.title, begin: t });
    if (v.kind === "report") e.reports = (e.reports ?? 0) + 1;
    if (v.kind === "end") Object.assign(e, { end: t, endMessage: v.message });
    progress.set(p.token, e);
  }
  if (msg.method === "textDocument/publishDiagnostics")
    diags.set(path.basename(p.uri), {
      at: t,
      count: p.diagnostics.length,
      messages: p.diagnostics.map((d) => `${d.severity}:${d.message}`),
    });
  if (msg.method === "window/showMessage" || msg.method === "window/logMessage")
    messages.push(`${t} ${msg.method} type=${p.type} ${p.message}`);
}
console.log(
  JSON.stringify(
    {
      server_methods: methods,
      progress: [...progress.values()],
      diagnostics_last: Object.fromEntries(diags),
      messages,
    },
    null,
    2,
  ),
);
