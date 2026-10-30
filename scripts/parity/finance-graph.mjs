// The finance lineage graph: a dbt manifest's connected lineage, as the layout is run on it. Shared by the spike
// (scripts/spikes/graph-layout/vpsc-spike.mjs finance) and the parity export (print-fixtures.mjs layering-finance), so
// both lay out the same graph. Contributor tooling only; it ships nothing.

const LAYERS = ["source", "staging", "intermediate", "marts"];

const tagOf = (id, node) => {
  if (id.startsWith("source.")) {
    return "source";
  }
  const p = node?.original_file_path ?? "";
  if (/staging/.test(p)) {
    return "staging";
  }
  if (/intermediate/.test(p)) {
    return "intermediate";
  }
  if (/marts/.test(p)) {
    return "marts";
  }
  return "other";
};

/**
 * The graph of `manifest` (a parsed dbt manifest.json): the dbt lineage of the connected part, four layer bands and one
 * cluster per unlayered node. Built as in /tmp/bench/full-graph.mjs.
 */
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
  return {
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
}
