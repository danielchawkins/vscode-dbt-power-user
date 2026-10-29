import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { components } from "../constraints/components.js";
import { order } from "../order/index.js";
import { rank } from "../rank/index.js";
import { caseArb as boxCaseArb, boxViolations } from "../testing/boxes.js";
import { caseArb, routeOptions } from "../testing/routeGraphs.js";
import type { LayoutGraph, LayoutHints, LayoutOptions } from "../types.js";
import { type Placement, place } from "./index.js";

const TIMEOUT = 20_000;

/** Lays out `graph` with the given direction, effort, ranks and hints. */
function placeWith(
  graph: LayoutGraph,
  options: Pick<LayoutOptions, "direction" | "effort" | "ranks"> & {
    hints?: LayoutHints;
  },
): Placement {
  const opts: LayoutOptions = { ...routeOptions, ...options };
  const ordering = order(graph, opts, rank(graph, opts));
  return place(graph, opts, ordering);
}

/** Lays out `graph` under `ranks: "levels"`. */
function levelsOf(
  graph: LayoutGraph,
  options: Pick<LayoutOptions, "direction" | "effort"> & {
    hints?: LayoutHints;
  },
): Placement {
  return placeWith(graph, { ...options, ranks: "levels" });
}

/** The ids of the edges of a ranking kind whose ends share a strongly connected component of the ranking graph. */
function cyclicEdges(graph: LayoutGraph): Set<string> {
  const index = new Map(graph.nodes.map((node, i) => [node.id, i] as const));
  const ranking = graph.edges.filter(
    (edge) => routeOptions.edgeKinds[edge.kind]?.ranks === true,
  );
  const comp = components(
    graph.nodes.length,
    ranking.map((edge) => [index.get(edge.source)!, index.get(edge.target)!]),
  );
  return new Set(
    graph.edges
      .filter(
        (edge) =>
          comp[index.get(edge.source)!] === comp[index.get(edge.target)!],
      )
      .map((edge) => edge.id),
  );
}

describe("levels: the across axis is solved per node", () => {
  it(
    "puts every ranking edge outside a cycle downward",
    () => {
      fc.assert(
        fc.property(caseArb, ({ graph, direction, effort }) => {
          const { nodes } = levelsOf(graph, { direction, effort });
          const cyclic = cyclicEdges(graph);
          for (const edge of graph.edges) {
            if (
              routeOptions.edgeKinds[edge.kind]?.ranks !== true ||
              cyclic.has(edge.id)
            ) {
              continue;
            }
            const from = nodes.get(edge.source)!;
            const to = nodes.get(edge.target)!;
            const [a, b] =
              direction === "down" ? [from.y, to.y] : [from.x, to.x];
            expect(b).toBeGreaterThan(a);
          }
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );

  it(
    "keeps no two nodes overlapping",
    () => {
      fc.assert(
        fc.property(caseArb, ({ graph, direction, effort }) => {
          const { nodes } = levelsOf(graph, { direction, effort });
          const boxes = graph.nodes.map((node) => ({
            p: nodes.get(node.id)!,
            w: node.width,
            h: node.height,
          }));
          boxes.forEach((a, i) => {
            boxes.slice(i + 1).forEach((b) => {
              const apart =
                Math.abs(a.p.x - b.p.x) >= (a.w + b.w) / 2 ||
                Math.abs(a.p.y - b.p.y) >= (a.h + b.h) / 2;
              expect(apart).toBe(true);
            });
          });
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );

  it(
    "keeps cluster boxes around their members and apart on both axes",
    () => {
      fc.assert(
        fc.property(boxCaseArb, ({ graph, direction, effort }) => {
          const { nodes, clusters } = levelsOf(graph, { direction, effort });
          const violations = boxViolations(graph, nodes, clusters);
          expect(violations).toEqual({
            members: [],
            nested: [],
            siblings: [],
            nodes: [],
            strangers: [],
          });
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT,
  );

  describe("hints across the ranks", () => {
    const graph: LayoutGraph = {
      nodes: ["a", "b"].map((id) => ({ id, width: 80, height: 40 })),
      edges: [],
    };
    const hints: LayoutHints = {
      nodes: new Map([
        ["a", { rank: 0, order: 0, x: 0, y: 300 }],
        ["b", { rank: 0, order: 1, x: 200, y: 0 }],
      ]),
    };
    const across = (stability: number) => {
      const opts: LayoutOptions = {
        ...routeOptions,
        direction: "down",
        ranks: "levels",
        hints,
        stability,
      };
      const placed = place(graph, opts, order(graph, opts, rank(graph, opts)));
      return ["a", "b"].map((id) => placed.nodes.get(id)!.y);
    };

    it("draws a hinted node to its hint's top plus half its height at high stability", () => {
      const [a, b] = across(1000);
      expect(a - b).toBeCloseTo(300, 0);
    });

    it("ignores the hints at stability zero", () => {
      const [a, b] = across(0);
      expect(a).toBeCloseTo(b, 6);
    });
  });

  it(
    "is not a relabelling of the rows: some graph draws its nodes at different heights",
    () => {
      const differs = fc
        .sample(caseArb, { numRuns: 200, seed: 7 })
        .some(({ graph, direction, effort }) => {
          const rows = placeWith(graph, { direction, effort, ranks: "rows" });
          const levels = placeWith(graph, {
            direction,
            effort,
            ranks: "levels",
          });
          return graph.nodes.some((node) => {
            const a = rows.nodes.get(node.id)!;
            const b = levels.nodes.get(node.id)!;
            return a.x !== b.x || a.y !== b.y;
          });
        });
      expect(differs).toBe(true);
    },
    TIMEOUT,
  );
});
