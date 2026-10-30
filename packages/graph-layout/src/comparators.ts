/**
 * Shared comparators for `sort` and `toSorted`. A sort that uses one of these gives the same order whatever array it
 * starts from: ties go to an index, a dense id or an input position, which the Rust port keeps as `sort_by` keys
 * (ADR 0011, "Determinism rules" 4). The ast-grep rule `ts-graph-layout-sort-tiebreak` requires them.
 */

/** Ascending order of plain numbers. Equal numbers are interchangeable, so there is no tie to break. */
export function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * Ascending by each of `keys` in turn, then ascending by `index`. `index` must be unique among the items being
 * sorted (an id, or the position in the input), so no two items compare equal.
 */
export function byThenIndex<T>(
  keys: readonly ((item: T) => number)[],
  index: (item: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const key of keys) {
      const d = key(a) - key(b);
      if (d !== 0) {
        return d;
      }
    }
    return index(a) - index(b);
  };
}

/**
 * `items` sorted by `keys`, with ties in input order. This is what a stable sort gives, written with the position
 * as the index, so the order does not depend on how the caller built the array.
 */
export function sortedInInputOrder<T>(
  items: readonly T[],
  keys: readonly ((item: T) => number)[],
): T[] {
  const at = (key: (item: T) => number) => (i: number) => key(items[i]!);
  return items
    .map((_, i) => i)
    .sort(byThenIndex(keys.map(at), (i) => i))
    .map((i) => items[i]!);
}
