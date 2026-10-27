import type { NetworkEdge } from "./networkSimplex.js";

/**
 * The spanning tree that network simplex pivots on. Each node carries a postorder range (`low` to `lim`) so that
 * `inSubtree` answers in constant time, and each tree edge carries its cut value: the weight that flows across the
 * cut it makes, forwards minus backwards. Gansner et al. (1993, section 2.4) update the cut values only along the
 * cycle that an exchange closes, which `exchange` does.
 */
export class SpanningTree {
  readonly #edges: readonly NetworkEdge[];
  readonly #adjacent: number[][];
  readonly #parentEdge: number[];
  readonly #low: number[];
  readonly #lim: number[];
  readonly #cut: number[];
  readonly #treeEdges: number[];
  readonly #slotOf: number[];

  /** `treeEdges` must form a spanning tree of the `count` nodes. The root is node 0. */
  constructor(
    count: number,
    edges: readonly NetworkEdge[],
    treeEdges: readonly number[],
  ) {
    this.#edges = edges;
    this.#adjacent = Array.from({ length: count }, () => []);
    this.#parentEdge = Array.from({ length: count }, () => -1);
    this.#low = Array.from({ length: count }, () => 0);
    this.#lim = Array.from({ length: count }, () => 0);
    this.#cut = Array.from({ length: edges.length }, () => 0);
    this.#treeEdges = [...treeEdges];
    this.#slotOf = Array.from({ length: edges.length }, () => -1);
    this.#treeEdges.forEach((ei, slot) => {
      this.#slotOf[ei] = slot;
      this.#adjacent[edges[ei]!.tail]!.push(ei);
      this.#adjacent[edges[ei]!.head]!.push(ei);
    });
    this.#number(0, 0);
    for (const f of this.#treeEdges) {
      this.#cut[f] = this.#cutOf(f);
    }
  }

  /** The tree edges, in a fixed slot order that a search can cycle through. */
  get treeEdges(): readonly number[] {
    return this.#treeEdges;
  }

  isTree(ei: number): boolean {
    return this.#slotOf[ei]! >= 0;
  }

  /** The cut value of a tree edge: negative means moving the tail-side component's end of it lowers the length. */
  cut(ei: number): number {
    return this.#cut[ei]!;
  }

  /** The endpoint of tree edge `ei` that lies further from the root. */
  childOf(ei: number): number {
    const e = this.#edges[ei]!;
    return this.#parentEdge[e.tail] === ei ? e.tail : e.head;
  }

  /** True when node `x` lies in the subtree hanging below node `v`. */
  inSubtree(v: number, x: number): boolean {
    return this.#low[v]! <= this.#lim[x]! && this.#lim[x]! <= this.#lim[v]!;
  }

  /**
   * Swaps tree edge `leave` for the non-tree edge `enter`, whose ends lie on the two sides `leave` separates. The
   * cut values on the cycle that `enter` closes are updated first, while the old numbering still holds.
   */
  exchange(leave: number, enter: number): void {
    const cutLeave = this.#cut[leave]!;
    const en = this.#edges[enter]!;
    const lca = this.#walk(en.tail, en.head, cutLeave);
    this.#walk(en.head, en.tail, -cutLeave);
    this.#cut[enter] = -cutLeave;
    this.#cut[leave] = 0;
    this.#replace(leave, enter);
    this.#number(lca, this.#low[lca]!);
  }

  /** The cut of a tree edge, computed from scratch: the sum over every edge that crosses the cut it makes. */
  #cutOf(f: number): number {
    const child = this.childOf(f);
    const tailIsChild = child === this.#edges[f]!.tail;
    let sum = 0;
    for (const x of this.#edges) {
      const tailIn = this.inSubtree(child, x.tail);
      if (tailIn === this.inSubtree(child, x.head)) {
        continue;
      }
      sum += (tailIn === tailIsChild ? 1 : -1) * x.weight;
    }
    return sum;
  }

  /**
   * Climbs from `v` to the first ancestor whose subtree holds `target`, adding `sign * scaled` to each tree edge on the
   * way, where `sign` is +1 when the edge points up out of `v` and -1 otherwise. Returns that ancestor.
   */
  #walk(v: number, target: number, scaled: number): number {
    let at = v;
    while (!this.inSubtree(at, target)) {
      const p = this.#parentEdge[at]!;
      const sign = this.#edges[p]!.tail === at ? 1 : -1;
      this.#cut[p] = this.#cut[p]! + sign * scaled;
      at = this.#other(p, at);
    }
    return at;
  }

  #replace(leave: number, enter: number): void {
    const out = this.#edges[leave]!;
    const inn = this.#edges[enter]!;
    for (const v of [out.tail, out.head]) {
      const list = this.#adjacent[v]!;
      list.splice(list.indexOf(leave), 1);
    }
    this.#adjacent[inn.tail]!.push(enter);
    this.#adjacent[inn.head]!.push(enter);
    const slot = this.#slotOf[leave]!;
    this.#treeEdges[slot] = enter;
    this.#slotOf[enter] = slot;
    this.#slotOf[leave] = -1;
  }

  #other(ei: number, v: number): number {
    const e = this.#edges[ei]!;
    return e.tail === v ? e.head : e.tail;
  }

  /**
   * Gives each node in the subtree of `start` a postorder number from `first` on, with `low` the least number below it.
   * The subtree keeps its node set across an exchange, so its numbers come out in the same range.
   */
  #number(start: number, first: number): void {
    const cursor: number[] = Array.from(
      { length: this.#adjacent.length },
      () => 0,
    );
    const stack = [start];
    let next = first;
    this.#low[start] = next;
    while (stack.length > 0) {
      const v = stack.at(-1)!;
      const adjacent = this.#adjacent[v]!;
      if (cursor[v]! < adjacent.length) {
        const ei = adjacent[cursor[v]!]!;
        cursor[v] = cursor[v]! + 1;
        if (ei === this.#parentEdge[v]) {
          continue;
        }
        const w = this.#other(ei, v);
        this.#parentEdge[w] = ei;
        this.#low[w] = next;
        stack.push(w);
      } else {
        this.#lim[v] = next;
        next++;
        stack.pop();
      }
    }
  }
}
