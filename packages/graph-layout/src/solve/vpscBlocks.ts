import { Forest, type Traversal } from "./vpscForest.js";

/** Parallel arrays for a block solve: targets, weights, and separations x[to] - x[from] >= gap. */
export interface BlockInput {
  readonly x0: readonly number[];
  readonly weight: readonly number[];
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly gap: readonly number[];
}

/** A rigid group of variables. Its position, in `Blocks.pos`, is the weighted mean of x0 - offset over its members. */
interface Block {
  members: number[];
  /** The smallest member: the root that `multipliers()` reaches the block from. */
  least: number;
  weight: number;
  /** Sum of weight * (x0 - offset) over the members. */
  weighted: number;
}

/**
 * Blocks of the variable-merging method of Dwyer, Marriott and Stuckey (GD 2005). Variable v sits at its block's
 * position plus `off[v]`. The active separations are tight and form a forest; its components are the blocks.
 */
export class Blocks {
  /** Offset of each variable from its block's position. */
  readonly off: Float64Array;
  /** Whether each separation is active: tight, and joining two variables of one block. */
  readonly active: boolean[];
  readonly count: number;
  /** Block id of each variable, an index into `blocks`. */
  readonly blockOf: Int32Array;
  /** Position of each block, by block id. Ids past the number of blocks are unused. */
  private readonly pos: Float64Array;
  private blocks: Block[] = [];
  private readonly input: BlockInput;
  private readonly forest: Forest;
  /** The ends and gap of each separation, as typed arrays for the violation scan. */
  private readonly from: Int32Array;
  private readonly to: Int32Array;
  private readonly gap: Float64Array;
  /** Scratch for negativeIn, sized once because it runs after every merge and split. */
  private readonly walk: Traversal;
  /** The variables one negativeIn call has walked so far, in `walk.queue` from index 0: each block's are contiguous. */
  private walkEnd = 0;
  private readonly walkSub: Float64Array;
  /** The inactive separations, ascending: the only ones the violation scan has to look at. */
  private readonly candidates: Int32Array;
  private candidateCount: number;

  constructor(input: BlockInput) {
    const n = input.x0.length;
    this.input = input;
    this.count = input.gap.length;
    this.from = Int32Array.from(input.from);
    this.to = Int32Array.from(input.to);
    this.gap = Float64Array.from(input.gap);
    this.forest = new Forest(input.from, input.to, n);
    this.off = new Float64Array(n);
    this.blockOf = new Int32Array(n);
    this.pos = new Float64Array(n);
    this.active = input.gap.map(() => false);
    this.candidates = Int32Array.from({ length: this.count }, (_, e) => e);
    this.candidateCount = this.count;
    this.walk = {
      seen: new Uint8Array(n),
      parentEdge: new Int32Array(n),
      queue: new Int32Array(n),
    };
    this.walkSub = new Float64Array(n);
    this.rebuild();
  }

  /** Current coordinate of variable v. */
  value(v: number): number {
    return this.pos[this.blockOf[v]!]! + this.off[v]!;
  }

  /**
   * The inactive separation with the largest violation: the smallest slack below `-tolerance`, the lowest index on a
   * tie. It is taken among those whose ends share a block when `within` is set, and among the others otherwise.
   */
  mostViolated(within: boolean, tolerance: number): number | undefined {
    const { from, to, gap, blockOf, off, pos, candidates } = this;
    let worst: number | undefined;
    let worstSlack = -tolerance;
    for (let i = 0; i < this.candidateCount; i++) {
      const e = candidates[i]!;
      const f = from[e]!;
      const t = to[e]!;
      const bf = blockOf[f]!;
      const bt = blockOf[t]!;
      if ((bf === bt) !== within) {
        continue;
      }
      const slack = pos[bt]! + off[t]! - (pos[bf]! + off[f]!) - gap[e]!;
      if (slack < worstSlack) {
        worst = e;
        worstSlack = slack;
      }
    }
    return worst;
  }

  /** The two variables separation e joins, its `from` end then its `to` end. */
  ends(e: number): [number, number] {
    return [this.input.from[e]!, this.input.to[e]!];
  }

  /**
   * Joins the blocks of separation e, which must lie in two different blocks, so that e becomes tight. The smaller
   * block is shifted rigidly and the two merge into one block.
   */
  join(e: number): void {
    const f = this.input.from[e]!;
    const t = this.input.to[e]!;
    const bf = this.blockOf[f]!;
    const bt = this.blockOf[t]!;
    const shift = this.input.gap[e]! - (this.off[t]! - this.off[f]!);
    const toMoves =
      this.blocks[bt]!.members.length <= this.blocks[bf]!.members.length;
    const keep = toMoves ? bf : bt;
    const move = toMoves ? bt : bf;
    this.shiftBlock(move, toMoves ? shift : -shift);
    const into = this.blocks[keep]!;
    const away = this.blocks[move]!;
    for (const v of away.members) {
      this.blockOf[v] = keep;
      into.members.push(v);
    }
    into.least = Math.min(into.least, away.least);
    into.weight += away.weight;
    into.weighted += away.weighted;
    this.pos[keep] = into.weighted / into.weight;
    away.members = [];
    this.active[e] = true;
    this.removeCandidate(e);
    this.forest.link(e);
  }

  /**
   * Resolves separation e, violated inside one block. Raising e's multiplier from zero circulates along the forest
   * path between its ends: the path separations pointing away from the first end lose multiplier. The first of those
   * to reach zero is released, and then e is joined. If that multiplier is already negative, it is split off alone.
   */
  resolveWithin(e: number): void {
    const f = this.input.from[e]!;
    const t = this.input.to[e]!;
    const lam = this.multipliers();
    const { parentEdge } = this.forest.spanningOrder(f);
    const losing = this.forest
      .path(f, t)
      .filter((p) => parentEdge[this.input.to[p]!]! === p);
    if (losing.length === 0) {
      throw new Error(`separation ${e} cannot be satisfied by its block`);
    }
    const first = losing.reduce((a, b) => (lam[b]! < lam[a]! ? b : a));
    const multiplier = lam[first]!;
    this.split([first]);
    if (multiplier >= 0) {
      this.join(e);
    }
  }

  /**
   * Lagrange multiplier of each active separation: the weighted residual of the variables on its `to` side. At the
   * optimum every multiplier is non-negative. Inactive separations get zero.
   */
  multipliers(): number[] {
    const { order, parentEdge } = this.forest.spanningOrder();
    const sub = this.input.x0.map(
      (x0, v) => this.input.weight[v]! * (this.value(v) - x0),
    );
    const lam = this.input.gap.map(() => 0);
    for (const v of order.toReversed()) {
      const e = parentEdge[v]!;
      if (e < 0) {
        continue;
      }
      const p = this.forest.other(e, v);
      const s = sub[v]!;
      lam[e] = this.input.to[e]! === v ? s : -s;
      sub[p] = sub[p]! + s;
    }
    return lam;
  }

  /**
   * The active separations whose multiplier is below `-tolerance`, in ascending order, looking only in the blocks of
   * `vertices`. Each such block is walked from its smallest member, the root `multipliers()` reaches it from, and
   * summed in the same order, so every multiplier equals the one `multipliers()` gives. Other blocks are not examined.
   */
  negativeIn(vertices: readonly number[], tolerance: number): number[] {
    const negative: number[] = [];
    this.walkEnd = 0;
    for (const v of vertices) {
      const root = this.blocks[this.blockOf[v]!]!.least;
      if (this.walk.seen[root]) {
        continue;
      }
      this.walkBlock(root, tolerance, negative);
    }
    for (let i = 0; i < this.walkEnd; i++) {
      this.walk.seen[this.walk.queue[i]!] = 0;
    }
    // ast-grep-ignore: ts-graph-layout-sort-tiebreak -- plain numbers: equal values are interchangeable, and the solver takes no layout module (solve-is-self-contained).
    return negative.sort((a, b) => a - b);
  }

  /**
   * Walks the block rooted at `root` as `multipliers()` does. Its variables are appended to the walk (`walk.queue`,
   * from `walkEnd`) and marked in `walk.seen` until the caller clears them. Its separations with a multiplier below
   * `-tolerance` are appended to `negative`.
   */
  private walkBlock(root: number, tolerance: number, negative: number[]): void {
    const { parentEdge, queue } = this.walk;
    const start = this.walkEnd;
    parentEdge[root] = -1;
    const end = this.forest.componentOrder(root, this.walk, start);
    this.walkEnd = end;
    for (let i = start; i < end; i++) {
      const u = queue[i]!;
      this.walkSub[u] =
        this.input.weight[u]! * (this.value(u) - this.input.x0[u]!);
    }
    for (let i = end - 1; i >= start; i--) {
      const u = queue[i]!;
      const e = parentEdge[u]!;
      if (e < 0) {
        continue;
      }
      const p = this.forest.other(e, u);
      const s = this.walkSub[u]!;
      const lam = this.input.to[e]! === u ? s : -s;
      if (lam < -tolerance) {
        negative.push(e);
      }
      this.walkSub[p] = this.walkSub[p]! + s;
    }
  }

  /** Deactivates the given active separations, splitting their blocks, and recomputes the positions. */
  split(edges: readonly number[]): void {
    for (const e of edges) {
      this.active[e] = false;
      this.forest.unlink(e);
    }
    this.refreshCandidates();
    this.rebuild();
  }

  /** Drops separation e, which has just become active, from the sorted candidates. */
  private removeCandidate(e: number): void {
    let lo = 0;
    let hi = this.candidateCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.candidates[mid]! < e) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.candidates.copyWithin(lo, lo + 1, this.candidateCount);
    this.candidateCount -= 1;
  }

  /** Lists the inactive separations again, ascending, after some have been deactivated. */
  private refreshCandidates(): void {
    let k = 0;
    for (let e = 0; e < this.count; e++) {
      if (!this.active[e]) {
        this.candidates[k] = e;
        k += 1;
      }
    }
    this.candidateCount = k;
  }

  /** Recomputes the blocks from the active forest. Offsets are kept, since every kept separation still holds. */
  private rebuild(): void {
    const { order, parentEdge } = this.forest.spanningOrder();
    const { x0, weight } = this.input;
    this.blocks = [];
    for (const v of order) {
      const e = parentEdge[v]!;
      if (e < 0) {
        this.blockOf[v] = this.blocks.length;
        this.blocks.push({ members: [], least: v, weight: 0, weighted: 0 });
      } else {
        this.blockOf[v] = this.blockOf[this.forest.other(e, v)]!;
      }
      const b = this.blocks[this.blockOf[v]]!;
      const w = weight[v]!;
      b.members.push(v);
      b.least = Math.min(b.least, v);
      b.weight += w;
      b.weighted += w * (x0[v]! - this.off[v]!);
    }
    this.blocks.forEach((b, id) => {
      this.pos[id] = b.weighted / b.weight;
    });
  }

  /** Moves every member of block `id` by `delta` in its offset. */
  private shiftBlock(id: number, delta: number): void {
    const b = this.blocks[id]!;
    for (const v of b.members) {
      this.off[v] = this.off[v]! + delta;
    }
    b.weighted -= delta * b.weight;
  }
}
