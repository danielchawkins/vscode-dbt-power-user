#!/usr/bin/env node
// Summarise an evidence run. Usage: node scripts/evidence/summarize.mjs <run-dir>
// Prints one line per step: exit code, argv (project path shortened to <P>, binary to <dbt>), extra env,
// and for `show --info column_lineage` steps the row count per child model and the distinct ingested_at values.
// For lsp steps it prints each request label and a one-line response. It never hides a step.
import fs from "node:fs";
import path from "node:path";

const run = path.resolve(process.argv[2]);
const ctx = fs.readFileSync(path.join(run, "context.txt"), "utf8");
console.log(ctx.trim());
const project = /project_dir: (.*)/.exec(ctx)[1];
const bin = /dbt_bin: (.*)/.exec(ctx)[1];
const base = new Set(/base_env: (.*)/.exec(ctx)[1].split(" "));
const short = (s) => s.split(project).join("<P>").split(bin).join("<dbt>");
const one = (v) => {
  if (v == null) return "null";
  if (v.timeout) return `TIMEOUT(${v.timeout}ms)`;
  if (v.error) return `error: ${v.error.message}`;
  const r = v.result;
  if (r == null) return "null";
  if (r.contents)
    return `hover: ${String(r.contents.value ?? r.contents)
      .replace(/\s+/g, " ")
      .slice(0, 100)}`;
  if (r.changes || r.documentChanges) {
    const ch =
      r.documentChanges ??
      Object.entries(r.changes).map(([uri, edits]) => ({
        textDocument: { uri },
        edits,
      }));
    return `edits: ${ch.map((c) => `${path.basename(c.textDocument.uri)}×${c.edits.length}`).join(" ")}`;
  }
  if (Array.isArray(r))
    return `array(${r.length}) ${short(JSON.stringify(r)).slice(0, 100)}`;
  return short(JSON.stringify(r)).slice(0, 140);
};
for (const step of fs.readdirSync(path.join(run, "steps")).sort()) {
  const dir = path.join(run, "steps", step);
  const res = JSON.parse(
    fs.readFileSync(path.join(dir, "result.json"), "utf8"),
  );
  const extra = res.env.filter((e) => !base.has(e));
  console.log(
    `\n${step}  exit=${res.exit_code}${extra.length ? `  env+: ${extra.join(" ")}` : ""}`,
  );
  console.log(`  ${short(res.argv.join(" ")).slice(0, 400)}`);
  const stdout = fs.readFileSync(path.join(dir, "stdout.txt"), "utf8");
  if (res.argv.includes("column_lineage") && res.argv.includes("json")) {
    try {
      const rows = JSON.parse(stdout);
      const by = {};
      for (const r of rows)
        by[r.child_node_unique_id.split(".").pop()] =
          (by[r.child_node_unique_id.split(".").pop()] ?? 0) + 1;
      console.log(
        `  lineage rows=${rows.length} by_child=${JSON.stringify(by)} ingested_at=${JSON.stringify([...new Set(rows.map((r) => r.ingested_at))])}`,
      );
    } catch {
      console.log(
        `  stdout not JSON: ${stdout.slice(0, 160).replace(/\n/g, " ")}`,
      );
    }
  }
  const stderr = fs.readFileSync(path.join(dir, "stderr.txt"), "utf8");
  const diag = (stdout + stderr)
    .split("\n")
    .filter((l) => /\[(error|warning)\]/.test(l));
  for (const d of diag.slice(0, 4)) console.log(`  ${short(d).slice(0, 220)}`);
  const lspResults = path.join(dir, "lsp-results.json");
  if (fs.existsSync(lspResults)) {
    for (const r of JSON.parse(fs.readFileSync(lspResults, "utf8"))) {
      if (r.label === "initialize") continue;
      console.log(`  ${r.label.padEnd(44)} ${one(r.response)}`);
    }
  }
}
