import type { LayoutOptions } from "./types.js";

/**
 * The work counts one run may spend. Every count is a cap: reaching it stops that search early, and no count changes
 * what a search would choose before it stops. `budgetOf` builds the budget from the options once per run, and each
 * phase reads its counts from it, so the counts sit in one table rather than one per phase.
 */
export interface Budget {
  /** Pivot cap of the rank network simplex. Every pivot keeps the ranks feasible. */
  readonly rankPivots: number;
  /** Order sweeps, each a median or barycentre pass with transposition. */
  readonly sweeps: number;
  /** Sifting passes after the sweeps of each search. Zero skips sifting. */
  readonly siftRounds: number;
  /** Sifting passes over the dummies alone, before each search, so that each dummy starts in a good place. */
  readonly dummySiftRounds: number;
  /** Dummy sifting passes for the hinted order; sifting stops early once a pass moves nothing. */
  readonly hintedDummySiftRounds: number;
  /** Seeded restarts from shuffled starting orders, beyond the hinted or depth-first start. */
  readonly restarts: number;
  /** Gradient-projection iterations of the placement solve. At zero, the Brandes and Köpf coordinates are the answer. */
  readonly placeIterations: number;
  /** Overlapping pairs of hyperedges examined in one routing. Past it, tracks keep left-edge order only. */
  readonly routePairs: number;
  /** Piece pairs a band's doglegs may test. */
  readonly doglegWork: number;
}

type Effort = NonNullable<LayoutOptions["effort"]>;

const BUDGETS: Record<Effort, Budget> = {
  fast: {
    rankPivots: 1_000,
    sweeps: 4,
    siftRounds: 0,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 0,
    placeIterations: 0,
    routePairs: 100_000,
    doglegWork: 20_000,
  },
  balanced: {
    rankPivots: 10_000,
    sweeps: 12,
    siftRounds: 3,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 0,
    placeIterations: 100,
    routePairs: 1_000_000,
    doglegWork: 200_000,
  },
  thorough: {
    rankPivots: 100_000,
    sweeps: 24,
    siftRounds: 3,
    dummySiftRounds: 3,
    hintedDummySiftRounds: 12,
    restarts: 8,
    placeIterations: 500,
    routePairs: 4_000_000,
    doglegWork: 1_000_000,
  },
};

/** The budget for the effort in `options`, `balanced` when it is unset. */
export function budgetOf(options: { effort?: Effort }): Budget {
  return BUDGETS[options.effort ?? "balanced"];
}
