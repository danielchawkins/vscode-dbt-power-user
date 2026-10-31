// The ordering fixtures of `print-fixtures.mjs order` and `order-finance`: the TypeScript `order` on the layering cases
// (the package graphs, the negative-zero bands and seeded random graphs) and on the finance lineage graph without
// clusters, each at every effort, unhinted and hinted. A case is written as its input (the layering encoding of
// `edgeRules`, with the node widths, which set the breadth of the layered nodes) and TypeScript's crossing count per
// effort and hint setting. It stores no order: the Rust check (order_checks.rs) ranks, lays out and orders the same input
// and compares the crossings. Contributor tooling only; it ships nothing.
//
// The caller registers the TypeScript resolve hook before importing this module, so the sources load after it.

import { readFileSync } from "node:fs";
import {
  bitsCsv,
  bitsHex,
  edgeRules,
  LINEAGE_OPTIONS,
  portedScope,
} from "./layering-graphs.mjs";

const { seededRandom } =
  await import("../../packages/graph-layout/src/random.ts");
const { order } =
  await import("../../packages/graph-layout/src/order/index.ts");

const EFFORTS = ["fast", "balanced", "thorough"];

/**
 * Hints for a case: each real node gets its rank and an order drawn as `u32 % 4` from `seededRandom(seed + 1000003)`,
 * keyed by its layered node id (TypeScript looks hints up by id). The draws are one per layered node in node order,
 * dummies included, so the Rust check replays the same draws (order_checks.rs).
 */
function randomHints(seed, layered) {
  const random = seededRandom(seed + 1000003);
  const nodes = new Map();
  layered.nodes.forEach((node) => {
    const drawn = Math.floor(random() * 4294967296) % 4;
    if (node.id !== undefined) {
      nodes.set(node.id, { rank: node.rank, order: drawn, x: 0, y: 0 });
    }
  });
  return { nodes };
}

/**
 * One case's line: its name, seed, partition mode, bands (IEEE bits, `-` for none), widths (IEEE bits), edges (the
 * `edgeRules` strings, `-` for none), and the results as `effort:hinted:crossings` with the crossings as IEEE bits.
 */
export function caseLine(
  {
    name,
    seed,
    graph,
    options,
    efforts = EFFORTS,
    hintSettings = [false, true],
  },
  { rank, layer },
) {
  const scope = portedScope(graph);
  const results = [];
  for (const effort of efforts) {
    const base = { ...options, effort };
    const ranking = rank(scope, base);
    const layered = layer(scope, base, ranking);
    for (const hinted of hintSettings) {
      const hints = hinted ? randomHints(seed, layered) : undefined;
      const result = order(
        scope,
        { ...base, seed, hints },
        { ...ranking, layered },
      );
      results.push(`${effort}:${hinted ? 1 : 0}:${bitsHex(result.crossings)}`);
    }
  }
  const edges = edgeRules(scope, options);
  return [
    "case",
    name,
    String(seed),
    options.partitions ?? "soft",
    scope.nodes
      .map((node) =>
        node.partition === undefined ? "-" : bitsHex(node.partition),
      )
      .join(","),
    bitsCsv(scope.nodes.map((node) => node.width)),
    edges.length > 0 ? edges.join(";") : "-",
    results.join(","),
  ].join("\t");
}

/** The ordering fixture: one line per layering case, the case's index as its seed. */
export function printOrder(HEADER, cases, deps) {
  return [
    HEADER,
    "# case <name> <seed> <mode> <bands> <widths> <edges> <results>: the input of a layering case (see layeringLine), with the node widths as IEEE bits; the results are order's crossings as effort:hinted:IEEE bits, hinted 1 with randomHints(seed).",
    ...cases.map((c, seed) =>
      caseLine(
        { name: c.name, seed, graph: c.graph, options: c.options },
        deps,
      ),
    ),
  ];
}

/** The finance lineage graph without clusters, at each effort: the same line as a layering case, seed 0. */
export function printOrderFinance(HEADER, manifestPath, deps) {
  if (manifestPath === undefined) {
    process.stderr.write(
      "usage: print-fixtures.mjs order-finance <manifest.json>\n",
    );
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return [
    HEADER,
    "# case <name> <seed> <mode> <bands> <widths> <edges> <results>: the finance lineage graph (scripts/parity/finance-graph.mjs) without clusters, as a layering case.",
    caseLine(
      {
        name: "finance",
        seed: 0,
        graph: deps.financeGraph(manifest),
        options: LINEAGE_OPTIONS,
      },
      deps,
    ),
  ];
}
