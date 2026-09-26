#!/usr/bin/env node
// Tabulate l*-experiment runs as markdown for docs/research/evidence/lsp-flags.md. Usage:
//   node l-report.mjs <run-dir>...
// Reads only the recorded files. Per LSP session (a step dir with lsp-command.json) one table row: step dir,
// argv after the common prefix, extra env, exit, `Analyzing` / `Background Analyzing` progress-end counts,
// final error-severity diagnostics, target/ files per directory (files-after.txt), the session's post steps
// (find-lineage, lineage, lineage-lsp-target, grep-logs) and one verdict per feature request (lsp-results.json).
// Non-session steps are listed after each table. Project dir -> <P>, binary -> <dbt>. Repeated target/ file
// lists (F*), LSP result lists (R*) and otel Invocation.eval_args sets (S*) are printed once at the end.
import fs from "node:fs";
import path from "node:path";

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const PREFIX =
  '--project-dir <P> --profiles-dir <P> --no-version-check --command-prefix "" --log-level-file trace';
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const lineageRead = (dir) => {
  if (!dir) return "—";
  const out = read(path.join(dir, "stdout.txt"));
  const err = read(path.join(dir, "stderr.txt"));
  const code = JSON.parse(read(path.join(dir, "result.json"))).exit_code;
  try {
    const r = JSON.parse(out);
    const ing = [...new Set(r.map((x) => x.ingested_at))];
    return `exit ${code}, ${r.length} rows${ing.length ? ` (ingested_at ${ing.join(", ")})` : ""}`;
  } catch {
    const m = /\[error\] \[(\w+) \((dbt\d+)\)/.exec(out + err);
    return `exit ${code}, ${m ? `${m[1]} ${m[2]}` : "no JSON"}`;
  }
};
const verdict = (resp) => {
  if (!resp) return "none";
  if (resp.timeout) return "timeout";
  if (resp.error) return `error ${resp.error.code}`;
  const r = resp.result;
  if (r == null || (Array.isArray(r) && r.length === 0)) return "null";
  if (r.contents) return "hover";
  if (r.changes || r.documentChanges) {
    const ch = r.documentChanges ?? Object.values(r.changes);
    return `${ch.reduce((n, c) => n + (c.edits ?? c).length, 0)} edits`;
  }
  if (Array.isArray(r)) return `${r.length} loc`;
  return "object";
};
const FEATURE_ABBR = [
  [/^hover /, "H "],
  [/^definition /, "D "],
  [/^references /, "R "],
  [/^prepareRename /, "PR "],
  [/^rename /, "RN "],
  [/^codeLens /, "CL "],
  [/^inlayHint /, "IH "],
  [/^executeCommand /, ""],
];
const abbr = (l) => FEATURE_ABBR.reduce((s, [re, to]) => s.replace(re, to), l);
const EVAL_SETS = new Map();
const FILE_SETS = new Map();
const RESULT_SETS = new Map();
const tag = (map, prefix, key) => {
  if (!map.has(key)) map.set(key, `${prefix}${map.size + 1}`);
  return map.get(key);
};

for (const run of process.argv.slice(2).map((r) => path.resolve(r))) {
  const ctx = read(path.join(run, "context.txt"));
  const project = /project_dir: (.*)/.exec(ctx)[1];
  const bin = /dbt_bin: (.*)/.exec(ctx)[1];
  const base = new Set(/base_env: (.*)/.exec(ctx)[1].split(" "));
  const short = (s) => s.split(project).join("<P>").split(bin).join("<dbt>");
  const steps = fs.readdirSync(path.join(run, "steps")).sort();
  const envOf = (dir) =>
    /env:\n((?: {2}.*\n)*)/
      .exec(read(path.join(dir, "command.txt")))[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((e) => e && !base.has(e))
      .join(" ")
      .split(project)
      .join("<P>");
  const name = path.basename(run);
  console.log(`\n### ${name}\n`);
  console.log(
    `Run \`$TMPDIR/fpu-ev/lsp-flags/${name}\`, ${/date_utc: (.*)/.exec(ctx)[1]}, harness \`${/harness_revision: (.*)/.exec(ctx)[1]}\`.\n`,
  );
  const sessions = [];
  const others = [];
  for (const step of steps) {
    const dir = path.join(run, "steps", step);
    if (!fs.existsSync(path.join(dir, "result.json"))) {
      others.push(`- \`${step}\`: unfinished (no result.json)`);
      continue;
    }
    if (fs.existsSync(path.join(dir, "lsp-command.json"))) {
      sessions.push({ step, dir, label: step.replace(/^\d+-/, "") });
      continue;
    }
    const label = step.replace(/^\d+-/, "");
    const POST = [
      "find-lineage",
      "find-outside-target",
      "transcript-notes",
      "grep-logs",
      "lineage",
      "lineage-lsp-target",
    ];
    const owner = sessions.find((x) =>
      POST.some((p) => label === `${x.label}-${p}`),
    );
    if (owner) {
      owner[label.slice(owner.label.length + 1)] = dir;
      if (label !== `${owner.label}-find-outside-target`) continue;
      if (!read(path.join(dir, "stdout.txt")).trim()) continue;
    }
    const res = JSON.parse(read(path.join(dir, "result.json")));
    const shown =
      res.argv[0] === "/bin/sh"
        ? "/bin/sh -c <script in command.txt>"
        : res.argv.join(" ");
    const out = read(path.join(dir, "stdout.txt")).trim();
    let note = "";
    if (res.argv.includes("column_lineage")) note = lineageRead(dir);
    else if (/find$/.test(res.argv[0]))
      note = out ? `${out.split("\n").length} paths` : "no paths";
    const env = envOf(dir);
    others.push(
      `- \`${step}\` exit ${res.exit_code}${env ? `, env \`${env}\`` : ""}: \`${short(shown)}\`${note ? ` → ${short(note)}` : ""}`,
    );
  }
  if (sessions.length) {
    console.log(
      "| Step dir | Extra argv | Extra env | Exit | Analyzing / Background ends | Final error diags | Files under target/ | find lineage | lineage (default) | lineage (target/.lsp) | grep -c (dbt-lsp.log; otel) | LSP results |",
    );
    console.log(
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
  }
  for (const s of sessions) {
    const cmd = JSON.parse(read(path.join(s.dir, "lsp-command.json")));
    const argv = short(
      cmd.argv
        .slice(4)
        .map((a) => (a === "" ? '""' : a))
        .join(" "),
    );
    const extra = argv
      .replace(PREFIX, "")
      .replace(/--otel-file-name \S+/, "")
      .trim();
    const res = JSON.parse(read(path.join(s.dir, "result.json")));
    const tr = read(path.join(s.dir, "lsp-transcript.jsonl"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    let a = 0;
    let b = 0;
    const lastDiag = new Map();
    for (const { dir: d, msg } of tr) {
      if (d !== "server->client" || !msg.method) continue;
      const v = msg.params?.value;
      if (msg.method === "$/progress" && v?.kind === "end") {
        if (v.message === "Analyzing") a++;
        if (v.message === "Background Analyzing") b++;
      }
      if (msg.method === "textDocument/publishDiagnostics")
        lastDiag.set(msg.params.uri, msg.params.diagnostics);
    }
    const errs = [...lastDiag.values()]
      .flat()
      .filter((x) => x.severity === 1).length;
    const groups = {};
    for (const l of read(path.join(s.dir, "files-after.txt"))
      .trim()
      .split("\n")
      .filter(Boolean)) {
      const f = l.split(" ").pop();
      if (!f.startsWith("target/")) continue;
      const g = path.dirname(f).replace(/^target\//, "");
      groups[g] = (groups[g] ?? 0) + 1;
    }
    const files = Object.entries(groups)
      .map(([g, n]) => `${g}×${n}`)
      .join(", ");
    const findOut = s["find-lineage"]
      ? read(path.join(s["find-lineage"], "stdout.txt")).trim()
      : "";
    const greps = read(path.join(s["grep-logs"] ?? "", "stdout.txt"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t"));
    const g = (file) =>
      [
        "lineage",
        "lineage-not-lineage_probe",
        "info_schema",
        "ArtifactWritten",
        "column_lineage",
      ]
        .map((p) => greps.find(([, pp, f]) => pp === p && file(f))?.[0] ?? "?")
        .join("/");
    const logs = `${g((f) => f.endsWith("dbt-lsp.log"))}; ${g((f) => f.endsWith(`${s.label}-otel.jsonl`))}`;
    const results = JSON.parse(
      read(path.join(s.dir, "lsp-results.json")) || "[]",
    )
      .filter((r) => r.label !== "initialize")
      .map((r) => `${abbr(r.label)}: ${verdict(r.response)}`)
      .join("; ");
    console.log(
      `| ${[
        `\`${s.step}\``,
        `\`${extra}\``,
        `\`${envOf(s.dir)}\``,
        res.exit_code,
        `${a} / ${b}`,
        errs,
        tag(FILE_SETS, "F", files || "none"),
        findOut ? findOut.split("\n").join(", ") : "none",
        lineageRead(s.lineage),
        lineageRead(s["lineage-lsp-target"]),
        logs,
        tag(RESULT_SETS, "R", results || "—"),
      ]
        .map(cell)
        .join(" | ")} |`,
    );
  }
  if (others.length) console.log(`\nOther steps:\n\n${others.join("\n")}`);
  // Distinct otel Invocation.eval_args per session (session-logs/<label>/<label>-otel.jsonl), minus dirs.
  // Each distinct set of eval_args gets a letter; sessions list their letter(s).
  const evalLines = [];
  for (const s of sessions) {
    const inv = new Set();
    for (const l of read(
      path.join(run, "session-logs", s.label, `${s.label}-otel.jsonl`),
    ).split("\n")) {
      if (!l.includes('"eval_args"')) continue;
      const ea = JSON.parse(l).attributes.eval_args;
      delete ea.profiles_dir;
      delete ea.project_dir;
      inv.add(short(JSON.stringify(ea)));
    }
    const key = [...inv].sort().join(" · ");
    evalLines.push(
      `\`${s.step}\` ${inv.size ? tag(EVAL_SETS, "S", key) : "(none)"}`,
    );
  }
  if (evalLines.length)
    console.log(
      `\notel \`Invocation.eval_args\` set per session: ${evalLines.join(", ")}.`,
    );
}
console.log("\n#### Files under target/ sets\n");
for (const [k, id] of FILE_SETS) console.log(`- ${id}: ${k}`);
console.log("\n#### LSP result sets\n");
for (const [k, id] of RESULT_SETS) console.log(`- ${id}: ${k}`);
console.log("\n#### otel `Invocation.eval_args` sets\n");
for (const [k, id] of EVAL_SETS)
  console.log(
    `- ${id}: ${k
      .split(" · ")
      .map((x) => `\`${x}\``)
      .join(" · ")}`,
  );
