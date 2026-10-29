import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { measureDrawing } from "../metrics.js";
import { order } from "../order/index.js";
import { place } from "../place/index.js";
import { rank } from "../rank/index.js";
import { caseArb as boxCaseArb, boxViolations } from "../testing/boxes.js";
import { drawingOf } from "../testing/drawings.js";
import { caseArb, routeGraph, routeOptions } from "../testing/routeGraphs.js";
import type { LayoutOptions } from "../types.js";

const TIMEOUT = 60_000;

const NO_VIOLATIONS = {
  members: [],
  nested: [],
  siblings: [],
  nodes: [],
  strangers: [],
};

describe("route under ranks: levels", () => {
  it(
    "leaves nodes and cluster boxes where placement put them, with no violations",
    () => {
      fc.assert(
        fc.property(boxCaseArb, ({ graph, direction, effort }) => {
          const opts: LayoutOptions = {
            ...routeOptions,
            direction,
            effort,
            ranks: "levels",
          };
          const placed = place(
            graph,
            opts,
            order(graph, opts, rank(graph, opts)),
          );
          const routing = routeGraph(graph, opts);
          expect(routing.nodes).toEqual(placed.nodes);
          expect(routing.clusters).toEqual(placed.clusters);
          expect(boxViolations(graph, routing.nodes, routing.clusters)).toEqual(
            NO_VIOLATIONS,
          );
        }),
        { numRuns: 60 },
      );
    },
    TIMEOUT,
  );

  it(
    "counts the crossings measureDrawing counts over its polylines, with no node overlaps",
    () => {
      fc.assert(
        fc.property(caseArb, ({ graph, direction, effort }) => {
          const routing = routeGraph(graph, {
            ...routeOptions,
            direction,
            effort,
            ranks: "levels",
          });
          expect(routing.work.crossings).toBe(
            measureDrawing(drawingOf(graph, routing)).crossings,
          );
          expect(
            boxViolations(graph, routing.nodes, routing.clusters).nodes,
          ).toEqual([]);
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );
});
