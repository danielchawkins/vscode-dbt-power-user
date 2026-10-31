#!/usr/bin/env node
// Flattens a graph into the text form the Rust layout benchmark reads (crates/graph-layout/src/engine/layout/bench.rs).
// One record per line, its fields tab-separated: `node id width height partition cluster`, `cluster id padding` and
// `edge id source target kind`. `-` is no band and no cluster. Contributor tooling only; it ships nothing.
//
//   node scripts/bench/flatten-graph.mjs finance <manifest.json> <out.txt>
//   node scripts/bench/flatten-graph.mjs synthetic <count> <seed> <out.txt>
//
// `finance` builds the dbt lineage graph of a manifest exactly as the TypeScript baseline did (`/tmp/bench/full-graph.mjs`
// on the finance dump): the parents of each kept node, the sources and models with a tag, the other nodes in clusters of
// their own. `synthetic` is the seeded random DAG of `syntheticDag` in scripts/parity/layering-graphs.mjs, with the
// same mulberry32 draws (`seededRandom` in packages/graph-layout/src/random.ts), so the same seed gives the same graph.
// The two counts the baseline recorded (finance 1,128 nodes and 1,297 edges; synthetic 3,000 and 5,902) are printed.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LAYERS = ["source", "staging", "intermediate", "marts"];
const CLUSTER_PADDING = 22;

/** mulberry32, as `seededRandom` in packages/graph-layout/src/random.ts: a draw in [0, 1) for each call. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** The lineage graph of a dbt manifest: the connected part, with each node's band and cluster. */
export function financeGraph(manifest) {
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
  const ids = [...used];
  const tags = ids.map((id) => tagOf(id, all[id]));
  const nodes = ids.map((id, i) => ({
    id,
    width: 280,
    height: 65,
    partition: tags[i] === "other" ? undefined : LAYERS.indexOf(tags[i]),
    cluster: tags[i] === "other" ? `other:${id}` : tags[i],
  }));
  const clusterIds = [
    ...LAYERS,
    ...ids.filter((_, i) => tags[i] === "other").map((id) => `other:${id}`),
  ];
  return {
    nodes,
    edges: pairs.map(([source, target], i) => ({
      id: `e${i}`,
      source,
      target,
      kind: "table",
    })),
    clusters: clusterIds.map((id) => ({ id, padding: CLUSTER_PADDING })),
  };
}

/** A seeded random DAG: each node after the first takes 1 to 3 parents among the earlier nodes. */
export function syntheticGraph(count, seed) {
  const random = seededRandom(seed);
  const nodes = Array.from({ length: count }, (_, i) => {
    const band = random() < 0.2 ? undefined : Math.floor(random() * 3);
    return {
      id: `n${i}`,
      width: 60,
      height: 30,
      partition: band,
      cluster: undefined,
    };
  });
  const edges = [];
  for (let i = 1; i < count; i++) {
    const parents = 1 + Math.floor(random() * 3);
    for (let k = 0; k < parents; k++) {
      const parent = Math.floor(random() * i);
      edges.push({
        id: `e${edges.length}`,
        source: `n${parent}`,
        target: `n${i}`,
        kind: "table",
      });
    }
  }
  return { nodes, edges, clusters: [] };
}

/** The text form of a graph, one record per line. Ids may not hold a tab or a newline. */
export function flatten(graph, description) {
  const field = (value) => {
    const text = String(value);
    if (/[\t\n]/.test(text)) {
      throw new Error(
        `an id holds a tab or a newline: ${JSON.stringify(text)}`,
      );
    }
    return text;
  };
  const lines = [`# ${description}`];
  for (const node of graph.nodes) {
    const partition = node.partition ?? "-";
    const cluster = node.cluster ?? "-";
    lines.push(
      [
        "node",
        field(node.id),
        node.width,
        node.height,
        partition,
        field(cluster),
      ].join("\t"),
    );
  }
  for (const cluster of graph.clusters) {
    lines.push(["cluster", field(cluster.id), cluster.padding].join("\t"));
  }
  for (const edge of graph.edges) {
    lines.push(
      [
        "edge",
        field(edge.id),
        field(edge.source),
        field(edge.target),
        field(edge.kind),
      ].join("\t"),
    );
  }
  return `${lines.join("\n")}\n`;
}

function main(argv) {
  const [kind, ...rest] = argv;
  if (kind === "finance" && rest.length === 2) {
    const [manifestPath, out] = rest;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const graph = financeGraph(manifest);
    writeFileSync(
      out,
      flatten(graph, `finance lineage graph of ${manifestPath}`),
    );
    console.log(
      `finance: nodes ${graph.nodes.length} edges ${graph.edges.length}`,
    );
    return;
  }
  if (kind === "synthetic" && rest.length === 3) {
    const [count, seed, out] = rest;
    const graph = syntheticGraph(Number(count), Number(seed));
    writeFileSync(
      out,
      flatten(graph, `synthetic DAG: ${count} nodes, seed ${seed}`),
    );
    console.log(
      `synthetic ${count} seed ${seed}: nodes ${graph.nodes.length} edges ${graph.edges.length}`,
    );
    return;
  }
  console.error(
    "usage: flatten-graph.mjs finance <manifest.json> <out.txt>\n       flatten-graph.mjs synthetic <count> <seed> <out.txt>",
  );
  process.exitCode = 2;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
