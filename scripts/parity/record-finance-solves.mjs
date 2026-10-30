#!/usr/bin/env node
// Lays out a dbt manifest's lineage graph with the TypeScript sources and dumps every placement solve (the VPSC
// separations solved by `solveSeparations`) as hex bits, one solve per line: effort, x0, weight, separations, outputs.
// The Rust check `finance_placement_solves_meet_every_separation` reads the dump (GRAPH_LAYOUT_FINANCE_SOLVES).
// Usage: node scripts/parity/record-finance-solves.mjs <manifest.json> <dump.txt>
// Contributor tooling only; it reads the manifest and writes the dump, and ships nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";

const [manifestPath, dumpPath] = process.argv.slice(2);
if (manifestPath === undefined || dumpPath === undefined) {
  process.stderr.write(
    "usage: record-finance-solves.mjs <manifest.json> <dump.txt>\n",
  );
  process.exit(2);
}

register("./record-solve-hook.mjs", import.meta.url);
const { layout } = await import("../../packages/graph-layout/src/index.ts");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const LAYERS = ["source", "staging", "intermediate", "marts"];
const tagOf = (id, node) => {
  if (id.startsWith("source.")) {
    return "source";
  }
  const path = node?.original_file_path ?? "";
  if (/staging/.test(path)) {
    return "staging";
  }
  if (/intermediate/.test(path)) {
    return "intermediate";
  }
  if (/marts/.test(path)) {
    return "marts";
  }
  return "other";
};
const all = { ...manifest.nodes, ...manifest.sources };
const keep = (id) => !id.startsWith("test.") && all[id] !== undefined;
const used = new Set();
const pairs = [];
for (const [child, parents] of Object.entries(manifest.parent_map)) {
  if (!keep(child)) {
    continue;
  }
  for (const parent of parents) {
    if (keep(parent)) {
      pairs.push([parent, child]);
      used.add(parent);
      used.add(child);
    }
  }
}
// The panel draws the connected part: sources with no dependants add nothing a reader can follow.
const ids = [...used];
const tags = ids.map((id) => tagOf(id, all[id]));
const graph = {
  nodes: ids.map((id, i) => ({
    id,
    width: 280,
    height: 65,
    ...(tags[i] === "other" ? {} : { partition: LAYERS.indexOf(tags[i]) }),
    cluster: tags[i] === "other" ? `other:${id}` : tags[i],
  })),
  edges: pairs.map(([s, t], i) => ({
    id: `e${i}`,
    source: s,
    target: t,
    kind: "table",
  })),
  clusters: [
    ...LAYERS.map((id) => ({ id, padding: 22 })),
    ...ids
      .filter((_, i) => tags[i] === "other")
      .map((id) => ({ id: `other:${id}`, padding: 22 })),
  ],
};
console.log(`nodes ${graph.nodes.length} edges ${graph.edges.length}`);

const bits = (x) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
};
const lines = [];
for (const effort of ["fast", "balanced"]) {
  globalThis.__solveLog = [];
  const result = layout(graph, {
    direction: "down",
    edgeKinds: { table: { ranks: true } },
    partitions: "soft",
    ranks: "rows",
    effort,
    spacing: { node: 28, rank: 36, edge: 6, cluster: 28 },
  });
  const log = globalThis.__solveLog;
  const threw = log.filter((entry) => entry.error !== undefined).length;
  console.log(
    `${effort}: ${log.length} solves, ${threw} threw, bounds ${Math.round(result.bounds.width)} x ${Math.round(result.bounds.height)}`,
  );
  for (const entry of log) {
    const seps = entry.seps
      .map((s) => `${s.from}:${s.to}:${bits(s.gap)}`)
      .join(";");
    const out =
      entry.out === undefined ? "error" : entry.out.map(bits).join(",");
    lines.push(
      [
        effort,
        entry.x0.map(bits).join(","),
        entry.weight.map(bits).join(","),
        seps,
        out,
      ].join("\t"),
    );
  }
}
writeFileSync(dumpPath, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} solves to ${dumpPath}`);
