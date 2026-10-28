import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { boxViolations, caseArb } from "../testing/boxes.js";
import { options } from "../testing/graphs.js";
import { routeGraph } from "../testing/routeGraphs.js";
import type { LayoutOptions } from "../types.js";

describe("route with cluster boxes", () => {
  it("recomputes the boxes after the ranks are re-stacked, so every rule still holds", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const opts: LayoutOptions = {
          ...options,
          direction: c.direction,
          effort: c.effort,
        };
        const routed = routeGraph(c.graph, opts);
        expect(boxViolations(c.graph, routed.nodes, routed.clusters)).toEqual({
          members: [],
          nested: [],
          siblings: [],
          nodes: [],
          strangers: [],
        });
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
