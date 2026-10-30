import { budgetOf } from "./budget.js";
import { indexed } from "./indexed.js";
import { type LayeredGraph, layer } from "./layering.js";
import type { OrderResult } from "./order/index.js";
import { order } from "./order/index.js";
import { type Placement, place } from "./place/index.js";
import { type RankResult, rank } from "./rank/index.js";
import { type Routing, route } from "./route/index.js";
import type { LayoutGraph, LayoutOptions } from "./types.js";

/** What each phase produced, in the order the phases run. */
export interface LayoutPhases {
  ranking: RankResult;
  layering: LayeredGraph;
  ordering: OrderResult;
  placement: Placement;
  routing: Routing;
}

/**
 * Indexes the input, then runs rank, layering, order, place and route in turn, each taking the previous phase's output
 * and the input as indexed once here. The run's budget is built once, and every phase reads its counts from it. The
 * input is not validated here; `layout` validates it first.
 */
export function runPhases(
  graph: LayoutGraph,
  options: LayoutOptions,
): LayoutPhases {
  const input = indexed(graph);
  const budget = budgetOf(options);
  const ranking = rank(input, options, budget);
  const layering = layer(input, options, ranking);
  const ordering = order(input, options, { ...ranking, layered: layering });
  const placement = place(input, options, ordering);
  const routing = route(input, options, { ordering, placement });
  return { ranking, layering, ordering, placement, routing };
}
