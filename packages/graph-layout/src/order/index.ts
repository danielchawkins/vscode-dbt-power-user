import { type LayeredGraph, layer } from "../layering.js";
import { seededRandom, shuffled } from "../random.js";
import type { RankResult } from "../rank/index.js";
import type { LayoutGraph, LayoutHints, LayoutOptions } from "../types.js";
import { createModel, type OrderModel } from "./model.js";
import { startingLayers } from "./seed.js";
import { sift } from "./sifting.js";
import { found, type Found, search } from "./sweeps.js";

type Effort = NonNullable<LayoutOptions["effort"]>;

/** Sweeps (each a median or barycentre pass with transposition) by effort. */
const SWEEPS: Record<Effort, number> = { fast: 4, balanced: 12, thorough: 24 };

/** Sifting passes by effort. Sifting is skipped at `fast`. */
const SIFT_ROUNDS: Record<Effort, number> = {
  fast: 0,
  balanced: 3,
  thorough: 3,
};

/** Seeded restarts from shuffled starting orders, beyond the hinted or depth-first start. */
const RESTARTS: Record<Effort, number> = { fast: 0, balanced: 0, thorough: 8 };

/** Passes of sifting over the dummies alone, before the search, so that each dummy starts in a good place. */
const DUMMY_SIFT_ROUNDS = 3;

/** Rounds of restarting from a result's own real-node order, at most, before the order is taken as settled. */
const SETTLE_ROUNDS = 8;

/** The layered graph, and the order of each rank including dummies, left to right. */
export interface OrderResult {
  layered: LayeredGraph;
  layers: number[][];
  /** Weighted crossings of `layers`. */
  crossings: number;
}

/**
 * Orders the nodes and dummies of each rank to reduce weighted crossings. The search starts from the hinted or
 * depth-first order and keeps the order with the fewest crossings seen. At `thorough`, seeded restarts from shuffled
 * starts are tried as well. The result is a pure function of the graph, options and seed.
 */
export function order(
  graph: LayoutGraph,
  options: LayoutOptions,
  ranking: RankResult,
): OrderResult {
  const layered = layer(graph, options, ranking);
  const effort: Effort = options.effort ?? "balanced";
  const random = seededRandom(options.seed ?? 0);
  const start = startingLayers(layered, options.hints);
  let best = settle(layered, start, effort);
  for (let r = 0; r < RESTARTS[effort]; r++) {
    const restart = start.map((layer) => shuffled(layer, random));
    const candidate = settle(layered, restart, effort);
    if (candidate.crossings < best.crossings) {
      best = candidate;
    }
  }
  return { layered, layers: best.layers, crossings: best.crossings };
}

/**
 * Searches from one starting order. Hints carry only the real nodes, so a result comes back from its own hints only if
 * the search from those hints ends where it started. The search therefore restarts from the hints of its own real-node
 * order until that order repeats, or for at most SETTLE_ROUNDS rounds.
 */
function settle(
  layered: LayeredGraph,
  start: number[][],
  effort: Effort,
): Found {
  let current = refine(layered, start, effort);
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    const hints = hintsOf(layered, current.layers);
    const next = refine(layered, startingLayers(layered, hints), effort);
    if (sameRealOrder(layered, next.layers, current.layers)) {
      return next;
    }
    current = next;
  }
  return current;
}

/** Searches from one starting order, after sifting its dummies, then sifts the result. */
function refine(
  layered: LayeredGraph,
  layers: number[][],
  effort: Effort,
): Found {
  const model: OrderModel = createModel(
    layered,
    layers.map((layer) => [...layer]),
  );
  sift(model, DUMMY_SIFT_ROUNDS, (x) => layered.nodes[x]!.id === undefined);
  search(model, SWEEPS[effort]);
  sift(model, SIFT_ROUNDS[effort]);
  return found(model);
}

/** Hints that place each real node at its index in its rank of `layers`, as a previous result gives them. */
function hintsOf(layered: LayeredGraph, layers: number[][]): LayoutHints {
  const nodes = new Map<
    string,
    { rank: number; order: number; x: number; y: number }
  >();
  layers.forEach((layer, rank) =>
    layer.forEach((x, k) => {
      const id = layered.nodes[x]!.id;
      if (id !== undefined) {
        nodes.set(id, { rank, order: k, x: 0, y: 0 });
      }
    }),
  );
  return { nodes };
}

/** Whether two orders put the real nodes of every rank in the same order. */
function sameRealOrder(
  layered: LayeredGraph,
  a: number[][],
  b: number[][],
): boolean {
  const reals = (layers: number[][]) =>
    layers.map((layer) =>
      layer.filter((x) => layered.nodes[x]!.id !== undefined),
    );
  return JSON.stringify(reals(a)) === JSON.stringify(reals(b));
}
