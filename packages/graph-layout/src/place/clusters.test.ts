import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { order } from "../order/index.js";
import { rank } from "../rank/index.js";
import { boxViolations, caseArb, type Case } from "../testing/boxes.js";
import { options } from "../testing/graphs.js";
import type { LayoutOptions } from "../types.js";
import { place } from "./index.js";

const NONE = {
  members: [],
  nested: [],
  siblings: [],
  nodes: [],
  strangers: [],
};

function placed(c: Case) {
  const opts: LayoutOptions = {
    ...options,
    direction: c.direction,
    effort: c.effort,
  };
  const ordering = order(c.graph, opts, rank(c.graph, opts));
  return place(c.graph, opts, ordering);
}

describe("place with cluster boxes", () => {
  it("keeps members in their boxes, nested boxes in their parents, and sibling boxes and nodes apart", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = placed(c);
        expect(boxViolations(c.graph, result.nodes, result.clusters)).toEqual(
          NONE,
        );
      }),
      { numRuns: 60 },
    );
  }, 120_000);

  it("returns a box for every cluster that has members", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = placed(c);
        const withMembers = new Set(
          c.graph.nodes.flatMap((node) =>
            node.cluster === undefined ? [] : [node.cluster],
          ),
        );
        for (const id of withMembers) {
          expect(result.clusters.has(id)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
