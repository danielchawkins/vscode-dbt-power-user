// Lineage subgraph sizes for a Declared Project, from the dbt Fusion `info_schema` parquet tables that `dbt parse`
// writes under `target/info_schema/v1`: `dag_nodes`, `edges`, `node_columns` and `column_lineage`.
// For every model, the subgraph the lineage panel draws when it opens the model and expands `hops` levels of
// parents and children. Writes `stats.json` and `LineageData`-shaped `p50.json` / `p95.json` for `hops`.
import { asyncBufferFromFile, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [infoSchema, outDir = "data", hopsArg = "1"] = process.argv.slice(2);
const hopsForData = Number(hopsArg);
const read = async (table, columns) =>
  parquetReadObjects({ file: await asyncBufferFromFile(join(infoSchema, `${table}.parquet`)), columns, compressors });

// The resource types the panel draws as tables (`createTable` in src/features/lineage/dbtLineageService.ts).
const drawnTypes = new Set(["model", "seed", "snapshot", "source", "exposure", "metric", "function"]);
const typeOf = (id) => id.split(".")[0];
const drawn = (id) => drawnTypes.has(typeOf(id));

const dagNodes = (await read("dbt.dag_nodes", ["unique_id"])).map((r) => r.unique_id).filter(drawn);
const nodeSet = new Set(dagNodes);
const parents = new Map();
const children = new Map();
const add = (map, k, v) => (map.get(k) ?? map.set(k, new Set()).get(k)).add(v);
for (const { parent_unique_id: p, child_unique_id: c } of await read("dbt.edges", ["parent_unique_id", "child_unique_id"])) {
  if (nodeSet.has(p) && nodeSet.has(c)) {
    add(parents, c, p);
    add(children, p, c);
  }
}
const columns = new Map();
const columnFields = ["node_unique_id", "column_name", "column_index", "data_type_inferred", "data_type"];
for (const r of await read("dbt.node_columns", columnFields)) {
  if (nodeSet.has(r.node_unique_id)) {
    (columns.get(r.node_unique_id) ?? columns.set(r.node_unique_id, []).get(r.node_unique_id)).push({
      name: r.column_name,
      index: Number(r.column_index ?? 0),
      data_type: r.data_type ?? r.data_type_inferred ?? null,
    });
  }
}
for (const list of columns.values()) {
  list.sort((a, b) => a.index - b.index);
}
const columnEdges = new Map();
const lineageFields = [
  "parent_node_unique_id",
  "parent_column_name",
  "child_node_unique_id",
  "child_column_name",
  "evolution",
];
for (const r of await read("dbt.column_lineage", lineageFields)) {
  const key = `${r.parent_node_unique_id}\u0000${r.child_node_unique_id}`;
  (columnEdges.get(key) ?? columnEdges.set(key, []).get(key)).push([
    r.parent_column_name,
    r.child_column_name,
    r.evolution,
  ]);
}

function closure(start, hops) {
  const seen = new Set([start]);
  for (const map of [parents, children]) {
    let frontier = [start];
    for (let h = 0; h < hops && frontier.length; h++) {
      const next = new Set();
      for (const n of frontier) {
        for (const m of map.get(n) ?? []) {
          if (!seen.has(m)) {
            seen.add(m);
            next.add(m);
          }
        }
      }
      frontier = [...next];
    }
  }
  return seen;
}

function lineageData(start, hops) {
  const nodes = closure(start, hops);
  // `column_lineage` spells columns as the warehouse does (upper case); `node_columns` keeps the model's spelling.
  const spelling = (id) => new Map((columns.get(id) ?? []).map((c) => [c.name.toLowerCase(), c.name]));
  const spellings = new Map([...nodes].map((id) => [id, spelling(id)]));
  const tables = [...nodes].sort().map((id) => ({
    table: id,
    label: id.split(".").pop(),
    nodeType: typeOf(id),
    childCount: children.get(id)?.size ?? 0,
    parentCount: parents.get(id)?.size ?? 0,
    columns: (columns.get(id) ?? []).map(({ name, data_type }) => ({ name, data_type })),
  }));
  const edges = [];
  const colEdges = [];
  const seenColumnEdges = new Set();
  let unmatched = 0;
  for (const p of nodes) {
    for (const c of children.get(p) ?? []) {
      if (!nodes.has(c)) {
        continue;
      }
      edges.push({ source: p, target: c });
      for (const [pc, cc, evolution] of columnEdges.get(`${p}\u0000${c}`) ?? []) {
        const from = spellings.get(p).get(pc.toLowerCase());
        const to = spellings.get(c).get(cc.toLowerCase());
        if (!from || !to) {
          unmatched++;
          continue;
        }
        const key = `${p}/${from}\u0000${c}/${to}`;
        if (seenColumnEdges.has(key)) {
          continue;
        }
        seenColumnEdges.add(key);
        colEdges.push({ source: [p, from], target: [c, to], type: evolution === "copy" ? "direct" : "indirect" });
      }
    }
  }
  return { start, hops, tables, edges, columnEdges: colEdges, unmatchedColumnEdges: unmatched };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
const summary = (graphs, key) => {
  const xs = graphs.map((g) => g[key]);
  return { p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs) };
};
const sizeOf = (d) => ({
  start: d.start,
  nodes: d.tables.length,
  edges: d.edges.length,
  columns: d.tables.reduce((a, t) => a + t.columns.length, 0),
  columnEdges: d.columnEdges.length,
  unmatched: d.unmatchedColumnEdges,
});

const models = dagNodes.filter((id) => typeOf(id) === "model");
const perNode = dagNodes.map((id) => columns.get(id)?.length ?? 0);
const stats = {
  infoSchema,
  drawnNodes: dagNodes.length,
  byType: Object.fromEntries([...drawnTypes].map((t) => [t, dagNodes.filter((id) => typeOf(id) === t).length])),
  edges: [...children.values()].reduce((a, s) => a + s.size, 0),
  columnLineageEdges: [...columnEdges.values()].reduce((a, l) => a + l.length, 0),
  columnsPerNode: { p50: pct(perNode, 50), p95: pct(perNode, 95), max: Math.max(...perNode) },
  byHops: {},
};
let picks;
for (const hops of [1, 2, 3]) {
  const graphs = models.map((m) => sizeOf(lineageData(m, hops)));
  stats.byHops[hops] = Object.fromEntries(
    ["nodes", "edges", "columns", "columnEdges", "unmatched"].map((k) => [k, summary(graphs, k)]),
  );
  if (hops === hopsForData) {
    // Ranked by node count, then column count, which dominates render cost; `max` is a stress case.
    const ranked = [...graphs].sort((a, b) => a.nodes - b.nodes || a.columns - b.columns || a.columnEdges - b.columnEdges);
    const at = (p) => ranked[Math.min(ranked.length - 1, Math.max(0, Math.ceil((p / 100) * ranked.length) - 1))];
    picks = { p50: at(50), p95: at(95), max: ranked.at(-1) };
  }
}
stats.picks = picks;

mkdirSync(outDir, { recursive: true });
for (const [name, pick] of Object.entries(picks)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(lineageData(pick.start, hopsForData)));
}
writeFileSync(join(outDir, "stats.json"), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
