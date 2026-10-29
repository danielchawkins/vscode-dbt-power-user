import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runPhases } from "../phases.js";
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

  it("draws each box tight along the ranks: its padding beyond its outermost layered member or nested box", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ordering, placement } = runPhases(c.graph, {
          ...options,
          direction: c.direction,
          effort: c.effort,
        });
        const down = c.direction === "down";
        const { plan, edges } = placement.boxes;
        const at = (i: number) => {
          const p = placement.points[i];
          return down ? p.x : p.y;
        };
        const half = (i: number) => ordering.layered.nodes[i].breadth / 2;
        plan.boxes.forEach((box, b) => {
          const children = plan.boxes.flatMap((child, k) =>
            child.parent === box.cluster ? [k] : [],
          );
          const left = Math.min(
            ...box.members.map((m) => at(m) - half(m)),
            ...children.map((k) => edges[2 * k]),
          );
          const right = Math.max(
            ...box.members.map((m) => at(m) + half(m)),
            ...children.map((k) => edges[2 * k + 1]),
          );
          expect(edges[2 * b]).toBeCloseTo(left - box.padding, 6);
          expect(edges[2 * b + 1]).toBeCloseTo(right + box.padding, 6);
        });
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
