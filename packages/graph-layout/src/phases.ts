import { budgetOf } from "./budget.js";
import type { OrderResult } from "./order/index.js";
import { order } from "./order/index.js";
import { type Placement, place } from "./place/index.js";
import { type RankResult, rank } from "./rank/index.js";
import { type Routing, route } from "./route/index.js";
import type { LayoutGraph, LayoutOptions } from "./types.js";

/** What each phase produced, in the order the phases run. */
export interface LayoutPhases {
  ranking: RankResult;
  ordering: OrderResult;
  placement: Placement;
  routing: Routing;
}

/**
 * Runs rank, order, place and route in turn, each taking the previous phase's output. The run's budget is built once,
 * here, and every phase reads its counts from it. The input is not validated here; `layout` validates it first.
 */
export function runPhases(
  graph: LayoutGraph,
  options: LayoutOptions,
): LayoutPhases {
  const budget = budgetOf(options);
  const ranking = rank(graph, options, budget);
  const ordering = order(graph, options, ranking);
  const placement = place(graph, options, ordering);
  const routing = route(graph, options, { ordering, placement });
  return { ranking, ordering, placement, routing };
}
