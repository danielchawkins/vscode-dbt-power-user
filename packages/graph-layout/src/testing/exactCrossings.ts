import { totalCrossings } from "../order/crossings.js";
import type { OrderResult } from "../order/index.js";
import { createModel, setLayer, unitsOf } from "../order/model.js";

// Test-only: the fewest weighted crossings any in-rank order of a layered graph reaches, by exhaustive search.

/** Orders tried before the search gives up; a fixture larger than this is not a gold-standard candidate. */
const MAX_ORDERS = 5_000_000;

/**
 * The minimum weighted crossing count over every in-rank order of `ordering`'s layered graph that keeps each cluster
 * contiguous, counted exactly as the ordering phase counts it, and one order that reaches it. Each rank's units (a
 * node with its port dummies) are permuted; the ranks, the dummy chains and the units' insides stay as they are.
 * Throws when the product of the ranks' permutation counts exceeds `MAX_ORDERS`.
 */
export function exactMinimumCrossings(ordering: OrderResult): {
  crossings: number;
  layers: number[][];
} {
  const { layered } = ordering;
  const unitsByRank = ordering.layers.map((layer) =>
    unitsOf(layer, layered.block),
  );
  const total = unitsByRank.reduce(
    (product, units) => product * factorial(units.length),
    1,
  );
  if (total > MAX_ORDERS) {
    throw new Error(
      `${total} orders exceed the exact search's limit of ${MAX_ORDERS}`,
    );
  }
  const model = createModel(
    layered,
    ordering.layers.map((layer) => [...layer]),
  );
  let best = { crossings: Number.POSITIVE_INFINITY, layers: ordering.layers };
  const visit = (rank: number): void => {
    if (rank === unitsByRank.length) {
      const crossings = totalCrossings(model);
      if (crossings < best.crossings) {
        best = { crossings, layers: model.layers.map((layer) => [...layer]) };
      }
      return;
    }
    for (const permutation of permutations(unitsByRank[rank])) {
      if (!contiguous(permutation, layered.paths)) {
        continue;
      }
      setLayer(model, rank, permutation.flat());
      visit(rank + 1);
    }
  };
  visit(0);
  return best;
}

/** Whether every cluster's units are one unbroken run in `units`. */
function contiguous(
  units: readonly (readonly number[])[],
  paths: readonly (readonly number[])[],
): boolean {
  const closed = new Set<number>();
  let open: readonly number[] = [];
  for (const unit of units) {
    const chain = paths[unit[0]];
    for (const c of open) {
      if (!chain.includes(c)) {
        closed.add(c);
      }
    }
    if (chain.some((c) => closed.has(c))) {
      return false;
    }
    open = chain;
  }
  return true;
}

/** Every ordering of `items`, by Heap's algorithm. */
function* permutations<T>(items: readonly T[]): Generator<T[]> {
  const a = [...items];
  const c = a.map(() => 0);
  yield [...a];
  let i = 1;
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[j], a[i]] = [a[i], a[j]];
      yield [...a];
      c[i] += 1;
      i = 1;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
}

function factorial(n: number): number {
  let product = 1;
  for (let k = 2; k <= n; k++) {
    product *= k;
  }
  return product;
}
