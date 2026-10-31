// The ordering fixtures of `print-fixtures.mjs order` and `order-finance`: the TypeScript `order` on seeded random layered
// graphs (with hints on odd seeds) and on the finance lineage graph without clusters, at each effort. The Rust check
// (order_checks.rs) replays the same inputs and compares the layers and the crossings bit for bit. Contributor tooling
// only; it ships nothing.
//
// The caller registers the TypeScript resolve hook before importing this module, so the sources load after it.

import { readFileSync } from "node:fs";
import { randomCrossingCase } from "./crossing-fixtures.mjs";
import {
  csv,
  bitsHex,
  LINEAGE_OPTIONS,
  portedScope,
} from "./layering-graphs.mjs";

const { seededRandom } =
  await import("../../packages/graph-layout/src/random.ts");
const { budgetOf } = await import("../../packages/graph-layout/src/budget.ts");
const { order } =
  await import("../../packages/graph-layout/src/order/index.ts");

const EFFORTS = ["fast", "balanced", "thorough"];
const ORDER_CASES = 120;

/**
 * Hints for a random case: node i gets its rank and an order drawn as `u32 % 4` from `seededRandom(seed + 1000003)`,
 * one draw per node in node order. The Rust check replays the draws (order_checks.rs).
 */
function randomHints(seed, layered) {
  const random = seededRandom(seed + 1000003);
  const nodes = new Map();
  layered.nodes.forEach((node, i) => {
    const drawn = Math.floor(random() * 4294967296) % 4;
    nodes.set(String(i), { rank: node.rank, order: drawn, x: 0, y: 0 });
  });
  return { nodes };
}

/** The order of each seeded random case, at each effort, and of the same case with hints (odd seeds). */
export function printOrder(HEADER) {
  const lines = [
    HEADER,
    "# case <seed> <effort> <hinted> <layers> <crossings>: order(...) on the random layered graph of crossing-fixtures (seed), at the effort, with hints from randomHints on odd seeds; layers ';' between ranks, ',' between nodes, '-' for an empty rank; crossings as IEEE bits.",
  ];
  for (let seed = 0; seed < ORDER_CASES; seed++) {
    const { layered } = randomCrossingCase(seed);
    const effort = EFFORTS[seed % EFFORTS.length];
    const hinted = seed % 2 === 1;
    const options = {
      seed,
      effort,
      ...(hinted ? { hints: randomHints(seed, layered) } : {}),
    };
    const result = order({}, options, {
      budget: budgetOf({ effort }),
      layered,
    });
    lines.push(
      [
        "case",
        String(seed),
        effort,
        hinted ? "1" : "0",
        result.layers.map((layer) => csv(layer)).join(";"),
        bitsHex(result.crossings),
      ].join(" "),
    );
  }
  return lines;
}

/**
 * The finance lineage graph without clusters, at each effort: the layered graph that `layer` builds (ranks, nodes,
 * segments, blocks and cluster paths, one line each, as the Rust check reads them), then the order `order` returns.
 */
export function printOrderFinance(
  HEADER,
  manifestPath,
  { rank, layer, financeGraph },
) {
  if (manifestPath === undefined) {
    process.stderr.write(
      "usage: print-fixtures.mjs order-finance <manifest.json>\n",
    );
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const scope = portedScope(financeGraph(manifest));
  const scopeIndex = new Map(scope.nodes.map((node, i) => [node.id, i]));
  const lines = [
    HEADER,
    "# effort <name>, then ranks, node <rank> <breadth> <scope index or ->, segment <top> <bottom> <weight> <top offset> <bottom offset>, block, paths, and the result: order <layers> <crossings>. Floats are IEEE bits.",
  ];
  for (const effort of EFFORTS) {
    const options = { ...LINEAGE_OPTIONS, effort };
    const ranking = rank(scope, options);
    const layered = layer(scope, options, ranking);
    lines.push(`effort ${effort}`);
    lines.push(`ranks ${layered.ranks}`);
    for (const node of layered.nodes) {
      const id = node.id === undefined ? "-" : String(scopeIndex.get(node.id));
      lines.push(`node ${node.rank} ${bitsHex(node.breadth)} ${id}`);
    }
    for (const s of layered.segments) {
      lines.push(
        `segment ${s.top} ${s.bottom} ${bitsHex(s.weight)} ${bitsHex(s.topOffset)} ${bitsHex(s.bottomOffset)}`,
      );
    }
    lines.push(`block ${csv(layered.block)}`);
    lines.push(`paths ${layered.paths.map((path) => csv(path)).join(" ")}`);
    const result = order(scope, options, { ...ranking, layered });
    lines.push(
      `order ${result.layers.map((layer) => csv(layer)).join(";")} ${bitsHex(result.crossings)}`,
    );
  }
  return lines;
}
