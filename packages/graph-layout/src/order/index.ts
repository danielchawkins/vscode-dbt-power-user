import { type LayeredGraph, layer } from "../layering.js";
import { seededRandom, shuffled } from "../random.js";
import type { RankResult } from "../rank/index.js";
import type { LayoutGraph, LayoutOptions } from "../types.js";
import { gatherClusters } from "./clusters.js";
import { createModel, type OrderModel, unitsOf } from "./model.js";
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

/** The layered graph, and the order of each rank including dummies, left to right. */
export interface OrderResult {
  layered: LayeredGraph;
  layers: number[][];
  /** Weighted crossings of `layers`. */
  crossings: number;
}

/**
 * Orders the nodes and dummies of each rank to reduce weighted crossings. The search starts from the hinted or
 * depth-first order and keeps the order with the fewest crossings seen; a restart replaces it only with strictly
 * fewer. Hints are a preference, not a constraint: the result can move hinted nodes. At `thorough`, seeded restarts
 * from shuffled starts are tried as well. The result is a pure function of the graph, options and seed.
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
  let best = refine(layered, start, effort);
  for (let r = 0; r < RESTARTS[effort]; r++) {
    const restart = start.map((layer) =>
      shuffled(unitsOf(layer, layered.block), random).flat(),
    );
    const candidate = refine(layered, restart, effort);
    if (candidate.crossings < best.crossings) {
      best = candidate;
    }
  }
  return { layered, layers: best.layers, crossings: best.crossings };
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
  gatherClusters(model);
  sift(model, DUMMY_SIFT_ROUNDS, (x) => layered.nodes[x]!.id === undefined);
  search(model, SWEEPS[effort]);
  sift(model, SIFT_ROUNDS[effort]);
  return found(model);
}
