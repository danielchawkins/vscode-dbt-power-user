// The crossing fixtures of the order phase (`print-fixtures.mjs crossings`): seeded random layered graphs with a starting
// order, and the weighted crossings of that order and the exact minimum, as TypeScript computes them. The Rust check
// (order_checks.rs) replays the same draws. Contributor tooling only; it ships nothing.
//
// The caller registers the TypeScript resolve hook before importing this module, so the sources load after it.

import { bitsHex, csv } from "./layering-graphs.mjs";

const { seededRandom, shuffled } =
  await import("../../packages/graph-layout/src/random.ts");
const { totalCrossings } =
  await import("../../packages/graph-layout/src/order/crossings.ts");
const { createModel } =
  await import("../../packages/graph-layout/src/order/model.ts");
const { exactMinimumCrossings } =
  await import("../../packages/graph-layout/src/testing/exactCrossings.ts");

const CROSSING_CASES = 200;

/**
 * A layered graph and its starting order, from seeded draws. Each draw is `u32 % k` (`pick`) or a unit draw, in this
 * order: for each node its rank and breadth; then `count` segment candidates, each with its upper end, its lower end
 * (a node one rank down, when there is one), a weight, and the two port offsets; then each rank's nodes shuffled. The
 * Rust check (order_checks.rs) replays the same draws.
 */
export function randomCrossingCase(seed) {
  const random = seededRandom(seed);
  const pick = (k) => Math.floor(random() * 4294967296) % k;
  const ranks = 2 + pick(3);
  const count = 3 + pick(7);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const rank = pick(ranks);
    const breadth = 1 + pick(3);
    nodes.push({ rank, breadth });
  }
  const segments = [];
  const candidates = pick(2 * count);
  for (let k = 0; k < candidates; k++) {
    const top = pick(count);
    const below = nodes.flatMap((node, i) =>
      node.rank === nodes[top].rank + 1 ? [i] : [],
    );
    const pickBelow = pick(Math.max(1, below.length));
    const weight = [0.5, 1, 1.5, 2.25][pick(4)];
    const topOffset = random() * 4 - 2;
    const bottomOffset = random() * 4 - 2;
    if (below.length > 0) {
      segments.push({
        bundle: segments.length,
        top,
        bottom: below[pickBelow],
        weight,
        topOffset,
        bottomOffset,
      });
    }
  }
  const layers = Array.from({ length: ranks }, (_, r) =>
    shuffled(
      nodes.flatMap((node, i) => (node.rank === r ? [i] : [])),
      random,
    ),
  );
  const layered = {
    nodes: nodes.map(({ rank, breadth }, i) => ({
      id: String(i),
      rank,
      breadth,
    })),
    bundles: [],
    segments,
    block: nodes.map((_, i) => i),
    paths: nodes.map(() => []),
    ranks,
    spines: [],
  };
  return { layered, layers };
}

export function printCrossings(HEADER) {
  const lines = [
    HEADER,
    "# case <seed> <layers> <crossings> <exact>: the weighted crossings of the starting order (totalCrossings), and the fewest any in-rank order reaches (exactMinimumCrossings); layers ';' between ranks, ',' between nodes, '-' for an empty rank; floats as IEEE bits.",
  ];
  for (let seed = 0; seed < CROSSING_CASES; seed++) {
    const { layered, layers } = randomCrossingCase(seed);
    const crossings = totalCrossings(createModel(layered, layers));
    const exact = exactMinimumCrossings({
      layered,
      layers,
      budget: undefined,
      crossings,
    }).crossings;
    lines.push(
      [
        "case",
        String(seed),
        layers.map((layer) => csv(layer)).join(";"),
        bitsHex(crossings),
        bitsHex(exact),
      ].join(" "),
    );
  }
  return lines;
}
