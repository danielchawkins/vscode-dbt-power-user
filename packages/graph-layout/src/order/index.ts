import { type LayeredGraph, layer } from "../layering.js";
import { seededRandom, shuffled } from "../random.js";
import type { RankResult } from "../rank/index.js";
import type { LayoutGraph, LayoutOptions } from "../types.js";
import { gatherClusters } from "./clusters.js";
import { createModel, type OrderModel, unitsOf } from "./model.js";
import { keepOutside } from "./outside.js";
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

/** Passes of dummy sifting for the hinted order; sifting stops early once a pass moves nothing. */
const HINTED_DUMMY_SIFT_ROUNDS = 12;

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
 * fewer. Hints are a preference, not a constraint: the result can move hinted nodes, but keeps their order whenever
 * that order, with its dummies sifted, has no more crossings than the search found. With hints, the unhinted search
 * runs as well, so the order of the run that produced the hints is always among the candidates: the hints record no
 * dummy, and moving a long edge's dummies together across ranks is a step sifting cannot take. At `thorough`, seeded
 * restarts from shuffled starts are tried as well. Last, each long edge is kept on one side of every opaque cluster
 * box it may not enter (`keepOutside`). The result is a pure function of the graph, options and seed.
 */
export function order(
  graph: LayoutGraph,
  options: LayoutOptions,
  ranking: RankResult,
): OrderResult {
  const layered = layer(graph, options, ranking);
  const start = startingLayers(layered, options.hints);
  let best = searchFrom(layered, start, options);
  if (options.hints !== undefined) {
    const fresh = searchFrom(
      layered,
      startingLayers(layered, undefined),
      options,
    );
    if (fresh.crossings < best.crossings) {
      best = fresh;
    }
    // Dummies start where the seed put them, where the search did, or where the unhinted search did.
    const kept = [start, best.layers, fresh.layers]
      .map((found, i) => (i === 0 ? found : hintedOrder(layered, start, found)))
      .map((layers) => keepHinted(layered, layers))
      .reduce((a, b) => (b.crossings < a.crossings ? b : a));
    if (kept.crossings <= best.crossings) {
      best = kept;
    }
  }
  const layers = keepOutside(graph, layered, best.layers);
  return {
    layered,
    layers,
    crossings:
      layers === best.layers
        ? best.crossings
        : found(createModel(layered, layers)).crossings,
  };
}

/** The search from one start, then from `RESTARTS` shuffles of it, keeping the order with the fewest crossings. */
function searchFrom(
  layered: LayeredGraph,
  start: number[][],
  options: LayoutOptions,
): Found {
  const effort: Effort = options.effort ?? "balanced";
  const random = seededRandom(options.seed ?? 0);
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
  return best;
}

/**
 * `found`'s order with each rank's real units put back in their `start` order, in the slots real units hold in
 * `found`; dummy units stay where the search put them.
 */
function hintedOrder(
  layered: LayeredGraph,
  start: number[][],
  found: number[][],
): number[][] {
  const isReal = (unit: number[]) =>
    layered.nodes[layered.block[unit[0]!]!]!.id !== undefined;
  return found.map((layer, rank) => {
    const units = unitsOf(layer, layered.block);
    const hinted = unitsOf(start[rank]!, layered.block).filter(isReal);
    let next = 0;
    return units.flatMap((unit) => (isReal(unit) ? hinted[next++]! : unit));
  });
}

/**
 * The hinted order with its real nodes held in place and only the dummies sifted, so a layout fed its own hints keeps
 * its order whenever that order is no worse than what the search finds.
 */
function keepHinted(layered: LayeredGraph, layers: number[][]): Found {
  const model: OrderModel = createModel(
    layered,
    layers.map((layer) => [...layer]),
  );
  gatherClusters(model);
  sift(
    model,
    HINTED_DUMMY_SIFT_ROUNDS,
    (x) => layered.nodes[x]!.id === undefined,
  );
  return found(model);
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
