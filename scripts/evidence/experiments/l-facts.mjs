#!/usr/bin/env node
// Cross-session facts for docs/research/evidence/lsp-flags.md. Usage: node l-facts.mjs <run-dir>...
// Per LSP session: the set of server->client methods and the $/progress begin/end messages (from the
// transcript-notes step), error diagnostics text, and for every file under target/ whose name contains
// "lineage" (not "lineage_probe") the sha256 prefix and mtime in the session's files-after.txt next to the preceding step's.
// Also: whether any lineage read contains a row mentioning column "biggest".
import fs from "node:fs";
import path from "node:path";

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const methodSets = new Map();
const progressSets = new Map();
for (const run of process.argv.slice(2).map((r) => path.resolve(r))) {
  const project = /project_dir: (.*)/.exec(
    read(path.join(run, "context.txt")),
  )[1];
  const short = (s) => s.split(project).join("<P>");
  const steps = fs.readdirSync(path.join(run, "steps")).sort();
  console.log(`\n## ${path.basename(run)}`);
  for (const [i, step] of steps.entries()) {
    const dir = path.join(run, "steps", step);
    const label = step.replace(/^\d+-/, "");
    if (fs.existsSync(path.join(dir, "lsp-command.json"))) {
      const notesStep = steps.find((s) =>
        s.endsWith(`-${label}-transcript-notes`),
      );
      const notes = JSON.parse(
        read(path.join(run, "steps", notesStep, "stdout.txt")),
      );
      const m = Object.keys(notes.server_methods).sort().join(", ");
      if (!methodSets.has(m)) methodSets.set(m, `M${methodSets.size + 1}`);
      const endOf = (x) =>
        x.end ? `end ${JSON.stringify(x.endMessage ?? null)}` : "no end";
      const p = notes.progress
        .map((x) => `${JSON.stringify(x.title)}→${endOf(x)}`)
        .join(" | ");
      const pk = [
        ...new Set(
          notes.progress.map(
            (x) => `title ${JSON.stringify(x.title)} ${endOf(x)}`,
          ),
        ),
      ]
        .sort()
        .join("; ");
      if (!progressSets.has(pk))
        progressSets.set(pk, `P${progressSets.size + 1}`);
      const errs = Object.entries(notes.diagnostics_last).flatMap(([f, d]) =>
        d.messages.filter((x) => x.startsWith("1:")).map((x) => `${f}: ${x}`),
      );
      const lin = (s) =>
        read(path.join(run, "steps", s, "files-after.txt"))
          .split("\n")
          .filter(
            (l) =>
              /lineage(?!_probe)/.test(l.split(" ").pop() ?? "") &&
              l.includes("target/"),
          )
          .map((l) => short(l));
      const prev = steps[i - 1];
      console.log(
        `- ${step}: methods ${methodSets.get(m)} (${Object.values(notes.server_methods).reduce((a, b) => a + b, 0)} msgs); progress ${progressSets.get(pk)} [${p}]${errs.length ? `; error diags: ${errs.join(" / ")}` : ""}`,
      );
      const before = lin(prev);
      const after = lin(step);
      if (before.length || after.length) {
        console.log(
          `    lineage files before (${prev}): ${before.join(" ; ") || "none"}`,
        );
        console.log(`    lineage files after: ${after.join(" ; ") || "none"}`);
      }
    }
    if (/lineage/.test(label) && fs.existsSync(path.join(dir, "result.json"))) {
      const out = read(path.join(dir, "stdout.txt"));
      if (out.trim().startsWith("[") && out.length > 3) {
        const rows = JSON.parse(out);
        const b = rows.filter((r) =>
          JSON.stringify(r).includes("biggest"),
        ).length;
        const ot = rows.filter((r) =>
          String(r.child_node_unique_id).endsWith("order_totals"),
        ).length;
        console.log(
          `    ${step}: ${rows.length} rows, order_totals rows ${ot}, rows mentioning biggest ${b}`,
        );
      }
    }
  }
}
console.log("\n## method sets");
for (const [k, v] of methodSets) console.log(`- ${v}: ${k}`);
console.log("\n## progress sets");
for (const [k, v] of progressSets) console.log(`- ${v}: ${k}`);
