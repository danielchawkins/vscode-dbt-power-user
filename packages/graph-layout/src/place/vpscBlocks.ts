import { Forest } from "./vpscForest.js";

/** Parallel arrays for a block solve: targets, weights, and separations x[to] - x[from] >= gap. */
export interface BlockInput {
  readonly x0: readonly number[];
  readonly weight: readonly number[];
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly gap: readonly number[];
}

/** A rigid group of variables. Its position is the weighted mean of x0 - offset over its members. */
interface Block {
  members: number[];
  weight: number;
  /** Sum of weight * (x0 - offset) over the members. */
  weighted: number;
  pos: number;
}

/**
 * Blocks of the variable-merging method of Dwyer, Marriott and Stuckey (GD 2005). Variable v sits at its block's
 * position plus `off[v]`. The active separations are tight and form a forest; its components are the blocks.
 */
export class Blocks {
  /** Offset of each variable from its block's position. */
  readonly off: number[];
  /** Whether each separation is active: tight, and joining two variables of one block. */
  readonly active: boolean[];
  readonly count: number;
  /** Block id of each variable, an index into `blocks`. */
  blockOf: number[] = [];
  private blocks: Block[] = [];
  private readonly input: BlockInput;
  private readonly forest: Forest;
  /** Scratch for negativeIn, sized once because it runs after every merge and split. */
  private readonly walkSeen: boolean[];
  private readonly walkParent: number[];
  private readonly walkSub: number[];

  constructor(input: BlockInput) {
    const n = input.x0.length;
    this.input = input;
    this.count = input.gap.length;
    this.forest = new Forest(input.from, input.to, n);
    this.off = Array.from({ length: n }, () => 0);
    this.active = input.gap.map(() => false);
    this.walkSeen = Array.from({ length: n }, () => false);
    this.walkParent = Array.from({ length: n }, () => -1);
    this.walkSub = Array.from({ length: n }, () => 0);
    this.rebuild();
  }

  /** Current coordinate of variable v. */
  value(v: number): number {
    return this.blocks[this.blockOf[v]!]!.pos + this.off[v]!;
  }

  /** Slack of separation e: negative when it is violated. */
  slack(e: number): number {
    return (
      this.value(this.input.to[e]!) -
      this.value(this.input.from[e]!) -
      this.input.gap[e]!
    );
  }

  /** Whether the two ends of separation e lie in one block. */
  sameBlock(e: number): boolean {
    return (
      this.blockOf[this.input.from[e]!]! === this.blockOf[this.input.to[e]!]!
    );
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
    into.weight += away.weight;
    into.weighted += away.weighted;
    into.pos = into.weighted / into.weight;
    away.members = [];
    this.active[e] = true;
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
    const walked: number[] = [];
    for (const v of vertices) {
      const members = this.blocks[this.blockOf[v]!]!.members;
      const root = members.reduce((a, b) => (b < a ? b : a));
      if (this.walkSeen[root]!) {
        continue;
      }
      walked.push(...this.walkBlock(root, tolerance, negative));
    }
    for (const u of walked) {
      this.walkSeen[u] = false;
    }
    return negative.sort((a, b) => a - b);
  }

  /**
   * Walks the block rooted at `root` as `multipliers()` does, appending its separations with a multiplier below
   * `-tolerance` to `negative`. Returns the block's variables, which `walkSeen` marks until the caller clears it.
   */
  private walkBlock(
    root: number,
    tolerance: number,
    negative: number[],
  ): number[] {
    this.walkParent[root] = -1;
    const order = this.forest.componentOrder(
      root,
      this.walkSeen,
      this.walkParent,
    );
    for (const u of order) {
      this.walkSub[u] =
        this.input.weight[u]! * (this.value(u) - this.input.x0[u]!);
    }
    for (const u of order.toReversed()) {
      const e = this.walkParent[u]!;
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
    return order;
  }

  /** Deactivates the given active separations, splitting their blocks, and recomputes the positions. */
  split(edges: readonly number[]): void {
    for (const e of edges) {
      this.active[e] = false;
      this.forest.unlink(e);
    }
    this.rebuild();
  }

  /** Recomputes the blocks from the active forest. Offsets are kept, since every kept separation still holds. */
  private rebuild(): void {
    const { order, parentEdge } = this.forest.spanningOrder();
    const { x0, weight } = this.input;
    this.blocks = [];
    this.blockOf = Array.from({ length: x0.length }, () => 0);
    for (const v of order) {
      const e = parentEdge[v]!;
      if (e < 0) {
        this.blockOf[v] = this.blocks.length;
        this.blocks.push({ members: [], weight: 0, weighted: 0, pos: 0 });
      } else {
        this.blockOf[v] = this.blockOf[this.forest.other(e, v)]!;
      }
      const b = this.blocks[this.blockOf[v]]!;
      const w = weight[v]!;
      b.members.push(v);
      b.weight += w;
      b.weighted += w * (x0[v]! - this.off[v]!);
    }
    for (const b of this.blocks) {
      b.pos = b.weighted / b.weight;
    }
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
