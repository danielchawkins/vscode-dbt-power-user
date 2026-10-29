/**
 * Strongly connected components of a directed graph, by Tarjan's algorithm. The walk is iterative, so a long chain of
 * edges cannot exhaust the call stack. Two vertices share a component exactly when each reaches the other.
 */

/** The component of each vertex, numbered from zero in the order components complete. */
export function components(
  count: number,
  edges: readonly (readonly [number, number])[],
): number[] {
  const adjacent: number[][] = Array.from({ length: count }, () => []);
  for (const [from, to] of edges) {
    adjacent[from]!.push(to);
  }
  const walk = new Walk(adjacent);
  for (let v = 0; v < count; v++) {
    if (walk.index[v] === undefined) {
      walk.from(v);
    }
  }
  return walk.comp;
}

/** The state of one Tarjan pass: discovery indices, lowest reachable indices, and the stack of open vertices. */
class Walk {
  readonly index: (number | undefined)[];
  readonly comp: number[];
  private readonly low: number[];
  private readonly open: boolean[];
  private readonly stack: number[] = [];
  private next = 0;
  private found = 0;

  private readonly adjacent: readonly (readonly number[])[];

  constructor(adjacent: readonly (readonly number[])[]) {
    this.adjacent = adjacent;
    const count = adjacent.length;
    this.index = Array.from({ length: count }, () => undefined);
    this.low = Array.from({ length: count }, () => 0);
    this.open = Array.from({ length: count }, () => false);
    this.comp = Array.from({ length: count }, () => -1);
  }

  /** Walks everything reachable from `root` that is not yet numbered. */
  from(root: number): void {
    const frames: [number, number][] = [[root, 0]];
    this.enter(root);
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      const [v, k] = frame;
      const targets = this.adjacent[v]!;
      if (k < targets.length) {
        frame[1] = k + 1;
        const w = targets[k]!;
        if (this.index[w] === undefined) {
          this.enter(w);
          frames.push([w, 0]);
        } else if (this.open[w]) {
          this.low[v] = Math.min(this.low[v]!, this.index[w]);
        }
        continue;
      }
      frames.pop();
      const parent = frames.at(-1);
      if (parent !== undefined) {
        this.low[parent[0]] = Math.min(this.low[parent[0]]!, this.low[v]!);
      }
      if (this.low[v] === this.index[v]) {
        this.close(v);
      }
    }
  }

  private enter(v: number): void {
    this.index[v] = this.next;
    this.low[v] = this.next;
    this.next++;
    this.stack.push(v);
    this.open[v] = true;
  }

  /** Pops the component whose root is `v`. */
  private close(v: number): void {
    let w: number;
    do {
      w = this.stack.pop()!;
      this.open[w] = false;
      this.comp[w] = this.found;
    } while (w !== v);
    this.found++;
  }
}
