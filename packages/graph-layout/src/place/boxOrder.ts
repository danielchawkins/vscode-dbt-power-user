import type { Separation } from "./vpsc.js";

/** The parts of a cluster box that sibling ordering reads: its parent, and its left and right edge variables. */
interface BoxSpan {
  parent: number | undefined;
  left: number;
  right: number;
}

/**
 * The left-to-right order of the clusters that share a parent, the same in every rank where both appear. Each rank
 * gives the order of the clusters it shows; the orders are merged by a topological sort, smallest index first, so that
 * the sibling boxes of the whole drawing take one order.
 */
export function siblingOrder(
  layers: readonly (readonly number[])[],
  paths: readonly (readonly number[])[],
  clusters: number,
): number[] {
  const after = new Map<number, Set<number>>();
  for (const layer of layers) {
    const last = new Map<number, number>();
    for (const x of layer) {
      paths[x]!.forEach((c, d) => {
        const parent = d > 0 ? paths[x]![d - 1]! : -1;
        const prev = last.get(parent);
        if (prev !== undefined && prev !== c) {
          after.set(prev, (after.get(prev) ?? new Set()).add(c));
        }
        last.set(parent, c);
      });
    }
  }
  return topological(clusters, after);
}

/** A topological order of `count` items with edges `after`; items on a cycle fall back to index order. */
function topological(
  count: number,
  after: ReadonlyMap<number, ReadonlySet<number>>,
): number[] {
  const indegree = Array.from({ length: count }, () => 0);
  for (const targets of after.values()) {
    for (const t of targets) {
      indegree[t]! += 1;
    }
  }
  const done = Array.from({ length: count }, () => false);
  const order: number[] = [];
  while (order.length < count) {
    const ready = done.findIndex((d, c) => !d && indegree[c] === 0);
    const pick = ready === -1 ? done.findIndex((d) => !d) : ready;
    done[pick] = true;
    order.push(pick);
    for (const t of after.get(pick) ?? []) {
      indegree[t]! -= 1;
    }
  }
  return order;
}

/** Each box lies left of the next sibling box in `order`, a spacing apart; siblings share their parent's key. */
export function siblings(
  order: readonly number[],
  byCluster: ReadonlyMap<number, BoxSpan>,
  spacing: number,
): Separation[] {
  const last = new Map<number, BoxSpan>();
  const out: Separation[] = [];
  for (const c of order) {
    const box = byCluster.get(c);
    if (box === undefined) {
      continue;
    }
    const key = box.parent ?? -1;
    const prev = last.get(key);
    if (prev !== undefined) {
      out.push({ from: prev.right, to: box.left, gap: spacing });
    }
    last.set(key, box);
  }
  return out;
}
