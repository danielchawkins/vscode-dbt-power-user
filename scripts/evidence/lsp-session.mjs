// Minimal LSP client for evidence runs. Usage:
//   node lsp-session.mjs <projectDir> <steps.json> <outDir> -- <dbt executable> <dbt lsp args...>
// Spawns `<dbt> lsp --socket <port> <args>` with cwd=<projectDir> and the inherited env (run.sh supplies a clean one).
// Writes <outDir>/lsp-transcript.jsonl (every JSON-RPC message, both directions, with timestamps)
// and <outDir>/lsp-results.json (the response to each step). No filtering or summarising.
// Steps: {"wait": ms} | {"request": method, "params": {...}} | {"notify": method, "params": {...}}
//        | {"writeFile": relPath, "text": "..."}  (writes to disk; "$FILE_URI(rel)" expands in params)
//        | {"include": relPath}  (splices another step file, relative to this one)
//        | {"deleteFile": relPath}
//        | {"waitForProgressEnd": title, "timeoutMs": n, "fresh": bool}  ($/progress end of a token whose begin
//          had that title, or that message when the title is empty (Fusion's "Analyzing" begin has title "");
//          without "fresh" an end seen earlier in the session counts)
//        | {"waitForNotification": method, "timeoutMs": n, "fresh": bool}
//        | {"snapshot": label}  (writes <outDir>/snapshots/<label>.txt: size, sha256 prefix, path of target/ files)
//        | {"clientAnswers": {method: result | "$NO_ANSWER"}}  (overrides how later server->client requests are
//          answered; default: workspace/configuration like the extension, everything else null)
// A request with "async": true is not awaited; a later param value "$LAST_ID" becomes its id (for $/cancelRequest).
// <outDir>/lsp-steps.json records every step with the server messages received from its start until the next
// step starts; lsp-results.json entries also carry those messages as "serverMessages".
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const sep = process.argv.indexOf("--");
const [projectArg, stepsArg, outArg] = process.argv.slice(2, sep);
const [dbtBin, ...lspArgs] = process.argv.slice(sep + 1);
const root = fs.realpathSync(projectArg);
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });
const transcript = fs.createWriteStream(
  path.join(outDir, "lsp-transcript.jsonl"),
);
const log = (dir, msg) =>
  transcript.write(
    JSON.stringify({ t: new Date().toISOString(), dir, msg }) + "\n",
  );

const expand = (v) =>
  JSON.parse(
    JSON.stringify(v)
      .replace(
        /\$FILE_URI\(([^)]+)\)/g,
        (_, rel) => `file://${path.join(root, rel)}`,
      )
      .replace(/\$ROOT_URI/g, `file://${root}`),
  );

const server = net.createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const args = ["lsp", "--socket", String(server.address().port), ...lspArgs];
fs.writeFileSync(
  path.join(outDir, "lsp-command.json"),
  JSON.stringify(
    { cwd: root, argv: [dbtBin, ...args], env: process.env },
    null,
    2,
  ),
);
const child = spawn(dbtBin, args, {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.pipe(fs.createWriteStream(path.join(outDir, "lsp-stdout.txt")));
child.stderr.pipe(fs.createWriteStream(path.join(outDir, "lsp-stderr.txt")));
const sock = await new Promise((r) => server.once("connection", r));

let buf = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
// Every server message in arrival order, with the step index that was current when it arrived.
const seen = [];
const progressTitles = new Map();
let current = null;
let waiters = [];
let clientAnswers = {};
const send = (m) => {
  log("client->server", m);
  const s = JSON.stringify(m);
  sock.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
};
sock.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const h = buf.indexOf("\r\n\r\n");
    if (h < 0) return;
    const len = Number(
      /Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString())[1],
    );
    if (buf.length < h + 4 + len) return;
    const m = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString());
    buf = buf.subarray(h + 4 + len);
    log("server->client", m);
    if (m.method === "$/progress" && m.params?.value?.kind === "begin")
      progressTitles.set(
        m.params.token,
        m.params.value.title || m.params.value.message,
      );
    seen.push({ at: Date.now(), msg: m });
    current?.serverMessages.push(m);
    waiters = waiters.filter((w) => !w());
    if (m.id !== undefined && !m.method) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } else if (m.id !== undefined) {
      if (clientAnswers[m.method] === "$NO_ANSWER") continue;
      if (m.method in clientAnswers) {
        send({ jsonrpc: "2.0", id: m.id, result: clientAnswers[m.method] });
        continue;
      }
      // Same answers the extension gives (src/lsp/fusionLanguageClient.ts buildWorkspaceConfigurationResponse).
      const result =
        m.method === "workspace/configuration"
          ? m.params.items.map((i) =>
              i.section === "dbt"
                ? { lsp: { linter: { enabled: false } } }
                : null,
            )
          : null;
      send({ jsonrpc: "2.0", id: m.id, result });
    }
  }
});
const request = (method, params, timeoutMs = 60000) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => resolve({ timeout: timeoutMs }), timeoutMs);
  });

const matches = (step, e) =>
  step.waitForProgressEnd !== undefined
    ? e.msg.method === "$/progress" &&
      e.msg.params?.value?.kind === "end" &&
      progressTitles.get(e.msg.params.token) === step.waitForProgressEnd
    : e.msg.method === step.waitForNotification;
const waitFor = (step) => {
  const since = step.fresh ? Date.now() : 0;
  const hit = () => seen.find((e) => e.at >= since && matches(step, e));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const done = (e) =>
      resolve(
        e
          ? { matched: e.msg, elapsedMs: Date.now() - t0 }
          : { timeout: step.timeoutMs ?? 120000 },
      );
    if (hit()) return done(hit());
    waiters.push(() => (hit() ? (done(hit()), true) : false));
    setTimeout(() => done(hit()), step.timeoutMs ?? 120000);
  });
};
const snapshot = (label) => {
  const lines = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else {
        const data = fs.readFileSync(path.join(root, r));
        const sha = crypto
          .createHash("sha256")
          .update(data)
          .digest("hex")
          .slice(0, 12);
        lines.push(`${data.length} ${sha} ${r}`);
      }
    }
  };
  walk("target");
  fs.mkdirSync(path.join(outDir, "snapshots"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "snapshots", `${label}.txt`),
    lines.join("\n") + "\n",
  );
  return lines.length;
};
const loadSteps = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8")).flatMap((s) =>
    s.include ? loadSteps(path.resolve(path.dirname(file), s.include)) : [s],
  );

const results = [];
const stepLog = [];
const asyncResults = [];
let lastId = null;
const steps = expand(loadSteps(stepsArg));
for (const [i, step] of steps.entries()) {
  current = {
    step: i,
    startedAt: new Date().toISOString(),
    ...step,
    serverMessages: [],
  };
  stepLog.push(current);
  if (step.params?.id === "$LAST_ID")
    step.params = { ...step.params, id: lastId };
  if (step.wait) await new Promise((r) => setTimeout(r, step.wait));
  else if (step.writeFile)
    fs.writeFileSync(path.join(root, step.writeFile), step.text);
  else if (step.deleteFile)
    fs.rmSync(path.join(root, step.deleteFile), { force: true });
  else if (step.waitForProgressEnd !== undefined || step.waitForNotification)
    current.outcome = await waitFor(step);
  else if (step.snapshot) current.outcome = { files: snapshot(step.snapshot) };
  else if (step.clientAnswers)
    clientAnswers = { ...clientAnswers, ...step.clientAnswers };
  else if (step.notify)
    send({ jsonrpc: "2.0", method: step.notify, params: step.params });
  else if (step.request) {
    if (step.at) {
      // {"at": {"file": rel, "find": text, "offset": n}} -> params.textDocument + params.position (first match).
      const lines = fs
        .readFileSync(path.join(root, step.at.file), "utf8")
        .split("\n");
      const line = lines.findIndex((l) => l.includes(step.at.find));
      step.params = {
        ...step.params,
        textDocument: { uri: `file://${path.join(root, step.at.file)}` },
        position: {
          line,
          character: lines[line].indexOf(step.at.find) + (step.at.offset ?? 0),
        },
      };
    }
    const entry = {
      step: i,
      label: step.label ?? step.request,
      request: step.request,
      params: step.params,
      id: nextId,
      response: undefined,
      serverMessages: current.serverMessages,
    };
    current.params = step.params;
    current.id = nextId;
    lastId = nextId;
    results.push(entry);
    const t0 = Date.now();
    const p = request(step.request, step.params, step.timeoutMs).then((r) => {
      entry.response = r;
      entry.elapsedMs = Date.now() - t0;
    });
    if (step.async) asyncResults.push(p);
    else await p;
  }
}
await Promise.all(asyncResults);
current = null;
fs.writeFileSync(
  path.join(outDir, "lsp-results.json"),
  JSON.stringify(results, null, 2),
);
fs.writeFileSync(
  path.join(outDir, "lsp-steps.json"),
  JSON.stringify(stepLog, null, 2),
);
await request("shutdown", null, 5000);
send({ jsonrpc: "2.0", method: "exit" });
setTimeout(() => {
  child.kill();
  process.exit(0);
}, 1000);
