import { type BlockInput, Blocks } from "./vpscBlocks.js";

/** A separation: x[to] - x[from] >= gap. */
export interface Separation {
  from: number;
  to: number;
  gap: number;
}

/** A separation whose slack is below this is violated and must be merged. */
const VIOLATION_TOLERANCE = 1e-9;
/** A block separation whose multiplier is below this is split off. */
const MULTIPLIER_TOLERANCE = 1e-9;

/**
 * Minimises the sum of weight[i] * (x[i] - x0[i])^2 subject to x[to] - x[from] >= gap for every separation, and returns
 * the optimum. Variable-block merging (Dwyer, Marriott and Stuckey, GD 2005) joins the blocks across violated
 * separations; a split step (Dwyer, Koren and Marriott, IEEE TVCG 12(5), 2006) releases a tree separation whose
 * multiplier is negative. The loop ends when every separation holds and every multiplier is non-negative: the KKT
 * conditions, so the result is the exact optimum. The separations must form a DAG, and a self-separation with a
 * positive gap cannot hold.
 */
export function solveSeparations(
  x0: readonly number[],
  weight: readonly number[],
  separations: readonly Separation[],
): number[] {
  const blocks = new Blocks(checkedInput(x0, weight, separations));
  const budget = { steps: STEP_FACTOR * (x0.length + blocks.count) };
  do {
    satisfy(blocks, budget);
  } while (splitNegative(blocks, budget));
  return x0.map((_, v) => blocks.value(v));
}

/** Operations allowed per variable and separation before the solver gives up on convergence. */
const STEP_FACTOR = 50;

/** Counts one solver operation against the budget, throwing when it is spent. */
function spend(budget: { steps: number }): void {
  budget.steps -= 1;
  if (budget.steps < 0) {
    throw new Error(
      "separation projection did not converge within its operation budget",
    );
  }
}

/**
 * Merges blocks across violated separations until none is violated, releasing a violation inside a block first. After
 * each change, negative multipliers are split off at once, so the multipliers stay non-negative between steps. After a
 * join only the blocks of its ends can have a negative multiplier, so only they are checked; after a release the whole
 * forest is.
 */
function satisfy(blocks: Blocks, budget: { steps: number }): void {
  for (;;) {
    spend(budget);
    const across = blocks.mostViolated(false, VIOLATION_TOLERANCE);
    if (across !== undefined) {
      blocks.join(across);
      splitNegativeIn(blocks, blocks.ends(across), budget);
    } else {
      const within = blocks.mostViolated(true, VIOLATION_TOLERANCE);
      if (within === undefined) {
        return;
      }
      blocks.resolveWithin(within);
      while (splitNegative(blocks, budget)) {
        // Each split leaves the multipliers of the remaining separations to be re-checked.
      }
    }
  }
}

/**
 * Splits off the active separations with negative multipliers in the blocks of `vertices`, then in the blocks of the
 * ends of each split, until none is left. Other blocks keep the non-negative multipliers they had, so none of them can
 * hold a negative one.
 */
function splitNegativeIn(
  blocks: Blocks,
  vertices: readonly number[],
  budget: { steps: number },
): void {
  let dirty = vertices;
  for (;;) {
    const negative = blocks.negativeIn(dirty, MULTIPLIER_TOLERANCE);
    if (negative.length === 0) {
      return;
    }
    spend(budget);
    blocks.split(negative);
    dirty = negative.flatMap((e) => blocks.ends(e));
  }
}

/** Splits off every active separation with a negative multiplier. Returns false when there is none. */
function splitNegative(blocks: Blocks, budget: { steps: number }): boolean {
  const lam = blocks.multipliers();
  const negative: number[] = [];
  for (let e = 0; e < blocks.count; e++) {
    if (blocks.active[e] && lam[e]! < -MULTIPLIER_TOLERANCE) {
      negative.push(e);
    }
  }
  if (negative.length === 0) {
    return false;
  }
  spend(budget);
  blocks.split(negative);
  return true;
}

/** Validates the arguments and drops self-separations, which hold whenever their gap is not positive. */
function checkedInput(
  x0: readonly number[],
  weight: readonly number[],
  separations: readonly Separation[],
): BlockInput {
  const n = x0.length;
  if (weight.length !== n) {
    throw new RangeError(`expected ${n} weights, got ${weight.length}`);
  }
  if (!weight.every((w) => w > 0)) {
    throw new RangeError("weights must be strictly positive");
  }
  const kept: Separation[] = [];
  for (const s of separations) {
    checkIndex(s.from, n);
    checkIndex(s.to, n);
    if (s.from !== s.to) {
      kept.push(s);
    } else if (s.gap > 0) {
      throw new Error(
        `variable ${s.from} cannot be separated from itself by ${s.gap}`,
      );
    }
  }
  assertAcyclic(n, kept);
  return {
    x0,
    weight,
    from: kept.map((s) => s.from),
    to: kept.map((s) => s.to),
    gap: kept.map((s) => s.gap),
  };
}

function checkIndex(v: number, n: number): void {
  if (!Number.isInteger(v) || v < 0 || v >= n) {
    throw new RangeError(`variable index ${v} is outside 0..${n - 1}`);
  }
}

/** Throws, naming the cycle, if the separations contain a directed cycle. */
function assertAcyclic(n: number, separations: readonly Separation[]): void {
  const indegree = Array.from({ length: n }, () => 0);
  const succ = Array.from({ length: n }, (): number[] => []);
  const pred = Array.from({ length: n }, (): number[] => []);
  for (const { from, to } of separations) {
    succ[from]!.push(to);
    pred[to]!.push(from);
    indegree[to] = indegree[to]! + 1;
  }
  const queue = indegree.flatMap((d, v) => (d === 0 ? [v] : []));
  for (const v of queue) {
    for (const w of succ[v]!) {
      indegree[w] = indegree[w]! - 1;
      if (indegree[w] === 0) {
        queue.push(w);
      }
    }
  }
  const stuck = indegree.flatMap((d, v) => (d > 0 ? [v] : []));
  const start = stuck[0];
  if (start === undefined) {
    return;
  }
  // Every stuck variable has a stuck predecessor, so walking back must revisit one: that closes a cycle.
  const walk: number[] = [];
  const position = new Map<number, number>();
  let v = start;
  while (!position.has(v)) {
    position.set(v, walk.length);
    walk.push(v);
    const p = pred[v]!.find((u) => indegree[u]! > 0);
    if (p === undefined) {
      throw new Error("separations contain a directed cycle");
    }
    v = p;
  }
  const cycle = walk.slice(position.get(v) ?? 0).reverse();
  throw new Error(
    `separations contain a directed cycle: ${[...cycle, cycle[0]].join(" -> ")}`,
  );
}
