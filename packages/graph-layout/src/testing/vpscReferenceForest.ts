/*
 * Test-only: a frozen copy of packages/graph-layout/src/solve/vpscForest.ts at the base revision (graph-layout: spike the warm-started projector).
 * The differential test in solve/vpscDifferential.test.ts runs the production solver against this copy and asserts
 * bit-identical output. Do not edit it: it is the reference the production solver is measured against.
 */
/** The active separations as a forest over the variables, given by their endpoints. */
export class Forest {
  private readonly from: readonly number[];
  private readonly to: readonly number[];
  private readonly n: number;
  /** Active separations at each variable. */
  private readonly tree: number[][];

  constructor(from: readonly number[], to: readonly number[], n: number) {
    this.from = from;
    this.to = to;
    this.n = n;
    this.tree = Array.from({ length: n }, (): number[] => []);
  }

  /** Makes separation e part of the forest. */
  link(e: number): void {
    this.tree[this.from[e]].push(e);
    this.tree[this.to[e]].push(e);
  }

  /** Removes separation e from the forest. */
  unlink(e: number): void {
    drop(this.tree[this.from[e]], e);
    drop(this.tree[this.to[e]], e);
  }

  /** The end of separation e that is not v. */
  other(e: number, v: number): number {
    const f = this.from[e];
    return f === v ? this.to[e] : f;
  }

  /**
   * Breadth-first order over the forest, with each variable's parent separation (-1 at a root). A parent comes before
   * its children, so reversing the order visits children first. The component of `first` is searched first and
   * rooted at `first`.
   */
  spanningOrder(first = 0): { order: number[]; parentEdge: number[] } {
    const seen = Array.from({ length: this.n }, () => false);
    const parentEdge = Array.from({ length: this.n }, () => -1);
    const order: number[] = [];
    for (let k = 0; k < this.n; k++) {
      const root = (first + k) % this.n;
      if (seen[root]) {
        continue;
      }
      order.push(...this.componentOrder(root, seen, parentEdge));
    }
    return { order, parentEdge };
  }

  /**
   * Breadth-first order of the component of `root`, rooted there. Its members are marked in `seen`, and each member
   * other than the root gets its parent separation in `parentEdge`. Both arrays are indexed by variable.
   */
  componentOrder(
    root: number,
    seen: boolean[],
    parentEdge: number[],
  ): number[] {
    seen[root] = true;
    const component = [root];
    for (const v of component) {
      for (const e of this.tree[v]) {
        const u = this.other(e, v);
        if (!seen[u]) {
          seen[u] = true;
          parentEdge[u] = e;
          component.push(u);
        }
      }
    }
    return component;
  }

  /** The separations on the forest path from variable a to variable b, which must be connected. */
  path(a: number, b: number): number[] {
    const via = Array.from({ length: this.n }, () => -1);
    const seen = Array.from({ length: this.n }, (_, v) => v === a);
    const queue = [a];
    for (const v of queue) {
      for (const e of this.tree[v]) {
        const u = this.other(e, v);
        if (!seen[u]) {
          seen[u] = true;
          via[u] = e;
          queue.push(u);
        }
      }
    }
    const edges: number[] = [];
    let v = b;
    while (v !== a) {
      const e = via[v];
      edges.push(e);
      v = this.other(e, v);
    }
    return edges;
  }
}

/** Removes the first occurrence of e from list, if present. */
function drop(list: number[], e: number): void {
  const at = list.indexOf(e);
  if (at >= 0) {
    list.splice(at, 1);
  }
}
