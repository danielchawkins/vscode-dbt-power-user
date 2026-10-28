import type { NetworkEdge } from "./networkSimplex.js";

/**
 * Extra network nodes and edges that a constraint adds to the ranking. Its nodes are numbered after the nodes it
 * was given, so the real nodes keep their indices.
 */
export interface Extension {
  /** Node count after the extension: the nodes given, then the ones the constraint adds. */
  count: number;
  edges: NetworkEdge[];
}

/** Cost per rank a node of a higher band sits above its gate, under soft partitions. */
const SOFT_PARTITION_WEIGHT = 1;

/** Weight that keeps each link of a hint's reference chain at exactly one rank. */
const CHAIN_WEIGHT = 1000;

/**
 * Bands of nodes kept in order: each band lies in earlier ranks than the next. One gate node sits between each pair
 * of adjacent bands. Every node of a band is at or above its gate (weight 0, minimum length 0).
 *
 * Under `strict`, every node of the next band lies below its gate (minimum length 1). Under `soft`, each such node
 * gets one mediator that costs `SOFT_PARTITION_WEIGHT` per rank the node sits above the gate. The mediator sits
 * at the larger of the node's rank and one more than the gate's rank, so the cost is the hinge
 * `max(0, gate + 1 - rank)`.
 */
export function partitionConstraints(
  partitions: readonly number[],
  mode: "strict" | "soft",
): Extension {
  const bands = [...new Set(partitions)].sort((a, b) => a - b);
  const gateOf = (k: number): number => partitions.length + k;
  let count = partitions.length + Math.max(0, bands.length - 1);
  const edges: NetworkEdge[] = [];
  partitions.forEach((band, node) => {
    const k = bands.indexOf(band);
    if (k + 1 < bands.length) {
      edges.push({ tail: node, head: gateOf(k), minLength: 0, weight: 0 });
    }
    if (k === 0) {
      return;
    }
    const gate = gateOf(k - 1);
    if (mode === "strict") {
      edges.push({ tail: gate, head: node, minLength: 1, weight: 0 });
      return;
    }
    const mediator = count++;
    edges.push({
      tail: node,
      head: mediator,
      minLength: 0,
      weight: SOFT_PARTITION_WEIGHT,
    });
    edges.push({ tail: gate, head: mediator, minLength: 1, weight: 0 });
  });
  return { count, edges };
}

/**
 * Keeps each hinted node near its hint: `weight * |rank - hint|`. The hints form a rigid chain of reference nodes, one
 * per rank from the lowest hint to the highest, linked at minimum length 1 with `CHAIN_WEIGHT`. Each hinted node gets
 * a mediator with two edges of `weight`, to the node and to its chain node. The mediator is pushed up to the lower of
 * the two, so its cost is `weight * |rank - hint|`. `hints[i]` is the hint for node `i`, or undefined for none.
 */
export function hintConstraints(
  count: number,
  hints: readonly (number | undefined)[],
  weight: number,
): Extension {
  const hinted: { node: number; rank: number }[] = [];
  hints.forEach((rank, node) => {
    if (rank !== undefined) {
      hinted.push({ node, rank });
    }
  });
  if (hinted.length === 0) {
    return { count, edges: [] };
  }
  const lo = hinted.reduce((m, h) => Math.min(m, h.rank), Infinity);
  const hi = hinted.reduce((m, h) => Math.max(m, h.rank), -Infinity);
  const chainStart = count;
  const edges: NetworkEdge[] = [];
  for (let r = 1; r <= hi - lo; r++) {
    edges.push({
      tail: chainStart + r - 1,
      head: chainStart + r,
      minLength: 1,
      weight: CHAIN_WEIGHT,
    });
  }
  let next = chainStart + (hi - lo) + 1;
  for (const { node, rank } of hinted) {
    const mediator = next++;
    const reference = chainStart + rank - lo;
    edges.push({ tail: mediator, head: node, minLength: 0, weight });
    edges.push({ tail: mediator, head: reference, minLength: 0, weight });
  }
  return { count: next, edges };
}
