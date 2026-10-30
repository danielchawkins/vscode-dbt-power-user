/** The active separations as a forest over the variables, given by their endpoints. */
export class Forest {
  private readonly from: readonly number[];
  private readonly to: readonly number[];
  private readonly n: number;
  /** Active separations at each variable. */
  private readonly tree: number[][];
  /** Bumped by every link and unlink, so a cached traversal can be checked against the forest it was made from. */
  private version = 0;
  private cached:
    | { version: number; first: number; order: number[]; parentEdge: number[] }
    | undefined;

  constructor(from: readonly number[], to: readonly number[], n: number) {
    this.from = from;
    this.to = to;
    this.n = n;
    this.tree = Array.from({ length: n }, (): number[] => []);
  }

  /** Makes separation e part of the forest. */
  link(e: number): void {
    this.tree[this.from[e]!]!.push(e);
    this.tree[this.to[e]!]!.push(e);
    this.version += 1;
  }

  /** Removes separation e from the forest. */
  unlink(e: number): void {
    drop(this.tree[this.from[e]!]!, e);
    drop(this.tree[this.to[e]!]!, e);
    this.version += 1;
  }

  /** The end of separation e that is not v. */
  other(e: number, v: number): number {
    const f = this.from[e]!;
    return f === v ? this.to[e]! : f;
  }

  /**
   * Breadth-first order over the forest, with each variable's parent separation (-1 at a root). A parent comes before
   * its children, so reversing the order visits children first. The component of `first` is searched first and
   * rooted at `first`. The result is cached until the forest changes, so its arrays must not be modified.
   */
  spanningOrder(first = 0): { order: number[]; parentEdge: number[] } {
    if (this.cached?.version === this.version && this.cached.first === first) {
      return this.cached;
    }
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
    this.cached = { version: this.version, first, order, parentEdge };
    return this.cached;
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
      for (const e of this.tree[v]!) {
        const u = this.other(e, v);
        if (!seen[u]!) {
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
      for (const e of this.tree[v]!) {
        const u = this.other(e, v);
        if (!seen[u]!) {
          seen[u] = true;
          via[u] = e;
          queue.push(u);
        }
      }
    }
    const edges: number[] = [];
    let v = b;
    while (v !== a) {
      const e = via[v]!;
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
