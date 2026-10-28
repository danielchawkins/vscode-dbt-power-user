/**
 * A Fenwick (binary indexed) tree over counts: point updates and prefix sums in O(log n). The sweep-line crossing
 * count in `metrics.ts` uses it.
 */
export class Fenwick {
  readonly #tree: number[];

  constructor(size: number) {
    this.#tree = Array.from({ length: size + 1 }, () => 0);
  }

  /** Adds `delta` to the entry at `index`. */
  add(index: number, delta: number): void {
    for (let i = index + 1; i < this.#tree.length; i += i & -i) {
      this.#tree[i] = (this.#tree[i] ?? 0) + delta;
    }
  }

  /** Sum of the entries before `end` (indices 0 to end - 1). */
  prefix(end: number): number {
    let sum = 0;
    for (let i = end; i > 0; i -= i & -i) {
      sum += this.#tree[i] ?? 0;
    }
    return sum;
  }
}
