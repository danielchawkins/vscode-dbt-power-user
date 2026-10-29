import { type LayoutPhases, runPhases } from "./phases.js";
import { resultOf } from "./result.js";
import type {
  LayoutGraph,
  LayoutInputIssue,
  LayoutOptions,
  LayoutResult,
} from "./types.js";
import { validateGraph } from "./validate.js";

/** The input `layout` refused, with every issue `validateGraph` found in it. */
export class LayoutInputError extends Error {
  readonly issues: readonly LayoutInputIssue[];

  constructor(issues: readonly LayoutInputIssue[]) {
    super(
      `layout refused the input: ${issues.map((i) => `${i.code} ${i.subject}`).join("; ")}`,
    );
    this.name = "LayoutInputError";
    this.issues = issues;
  }
}

/**
 * Lays out a graph: validates it, runs every phase and assembles the result. A pure function of the graph, the options
 * and the seed. Throws `LayoutInputError` when `validateGraph` reports any issue.
 *
 * Under `ranks: "levels"` a run that goes upward can pass through other nodes; `metrics.overlaps` counts those, and
 * node-node overlaps are still zero. Feeding `result.hints` back keeps every rank; see README, "Hints", for what else it
 * keeps.
 */
export function layout(
  graph: LayoutGraph,
  options: LayoutOptions,
): LayoutResult {
  const issues = validateGraph(graph, options);
  if (issues.length > 0) {
    throw new LayoutInputError(issues);
  }
  const phases: LayoutPhases = runPhases(graph, options);
  return resultOf(graph, options, phases);
}
