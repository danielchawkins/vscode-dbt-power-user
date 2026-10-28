import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  EdgeKindPolicy,
  LayoutEdge,
  LayoutGraph,
  LayoutHints,
  LayoutOptions,
} from "../types.js";
import { type RankResult, rank } from "./index.js";

const KINDS: Readonly<Record<string, EdgeKindPolicy>> = {
  light: { ranks: true, weight: 1 },
  medium: { ranks: true, weight: 2 },
  heavy: { ranks: true, weight: 3 },
  stretched: { ranks: true, weight: 1, minLength: 2 },
  info: { ranks: false },
};
const KIND_NAMES = Object.keys(KINDS);
const RANKING_KINDS = 3;
const INFO_KIND = KIND_NAMES.indexOf("info");

type Mode = "none" | "soft" | "strict";
const modeArb: fc.Arbitrary<Mode> = fc.constantFrom<Mode>(
  "none",
  "soft",
  "strict",
);

/** An edge as (source index, target index, kind index); nodes are named n0, n1, and so on. */
type Spec = [number, number, number];

interface Case {
  count: number;
  edges: Spec[];
  bands: number[];
}

const caseArb: fc.Arbitrary<Case> = fc
  .integer({ min: 1, max: 8 })
  .chain((count) => {
    const edge = fc.tuple(
      fc.nat(count - 1),
      fc.nat(count - 1),
      fc.nat(KIND_NAMES.length - 1),
    );
    return fc.record({
      count: fc.constant(count),
      edges: fc.array(edge, { maxLength: 12 }),
      bands: fc.array(fc.nat(2), { minLength: count, maxLength: count }),
    });
  });

/** Only edges that point from a lower index to a higher one, so the graph has no cycle. */
const dagOf = (edges: readonly Spec[]): Spec[] =>
  edges
    .filter(([a, b]) => a !== b)
    .map(([a, b, k]): Spec => [
      Math.min(a, b),
      Math.max(a, b),
      k % RANKING_KINDS,
    ]);

function graphOf(
  count: number,
  edges: readonly Spec[],
  bands: readonly number[],
): LayoutGraph {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    width: 10,
    height: 10,
    partition: bands[i],
  }));
  const links: LayoutEdge[] = edges.map(([a, b, k], i) => ({
    id: `e${i}`,
    source: `n${a}`,
    target: `n${b}`,
    kind: KIND_NAMES[k],
  }));
  return { nodes, edges: links };
}

const optionsWith = (partitions: Mode): LayoutOptions => ({
  direction: "down",
  edgeKinds: KINDS,
  partitions,
});

interface Arc {
  from: string;
  to: string;
  weight: number;
  minLength: number;
}

/** The ranking edges as laid out: each runs from its `from` rank to its `to` rank, after any reversal. */
function rankedArcs(graph: LayoutGraph, result: RankResult): Arc[] {
  const reversed = new Set(result.reversed);
  return graph.edges.flatMap((e) => {
    const policy = KINDS[e.kind];
    if (!policy.ranks || e.source === e.target) {
      return [];
    }
    const [from, to] = reversed.has(e.id)
      ? [e.target, e.source]
      : [e.source, e.target];
    return [
      {
        from,
        to,
        weight: policy.weight ?? 1,
        minLength: policy.minLength ?? 1,
      },
    ];
  });
}

const rankOf = (result: RankResult, id: string): number =>
  result.ranks.get(id) ?? NaN;

function weightedLength(graph: LayoutGraph, result: RankResult): number {
  return rankedArcs(graph, result).reduce(
    (sum, a) =>
      sum + a.weight * (rankOf(result, a.to) - rankOf(result, a.from)),
    0,
  );
}

interface IndexedArc {
  from: number;
  to: number;
  weight: number;
}

/**
 * The least total weighted length over rankings with every rank in 0 to count - 1, by branch and bound. A node with
 * no arc sits at 0, which costs nothing and keeps the search small.
 */
function bruteForceOptimum(count: number, arcs: readonly IndexedArc[]): number {
  const touched = new Set(arcs.flatMap((a) => [a.from, a.to]));
  const ranks: number[] = Array.from({ length: count }, () => 0);
  let best = Infinity;
  const search = (v: number, cost: number): void => {
    if (cost >= best) {
      return;
    }
    if (v === count) {
      best = cost;
      return;
    }
    const top = touched.has(v) ? count - 1 : 0;
    for (let r = 0; r <= top; r++) {
      ranks[v] = r;
      let added = 0;
      let ok = true;
      for (const arc of arcs) {
        if (arc.to !== v) {
          continue;
        }
        const span = ranks[arc.to] - ranks[arc.from];
        if (span < 1) {
          ok = false;
          break;
        }
        added += arc.weight * span;
      }
      if (ok) {
        search(v + 1, cost + added);
      }
    }
  };
  search(0, 0);
  return best;
}

describe("rank", () => {
  it("matches the brute-force optimum on DAGs of up to 8 nodes", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const edges = dagOf(c.edges);
        const graph = graphOf(c.count, edges, []);
        const result = rank(graph, optionsWith("none"));
        const arcs = edges.map(([a, b, k]) => ({
          from: a,
          to: b,
          weight: KINDS[KIND_NAMES[k]].weight ?? 1,
        }));
        expect(weightedLength(graph, result)).toBe(
          bruteForceOptimum(c.count, arcs),
        );
      }),
      { numRuns: 2000 },
    );
  }, 30_000);

  it("keeps every ranking edge at or above its minimum length, in every partition mode", () => {
    fc.assert(
      fc.property(caseArb, modeArb, (c, mode) => {
        const graph = graphOf(c.count, c.edges, c.bands);
        const result = rank(graph, optionsWith(mode));
        for (const arc of rankedArcs(graph, result)) {
          expect(
            rankOf(result, arc.to) - rankOf(result, arc.from),
          ).toBeGreaterThanOrEqual(arc.minLength);
        }
      }),
      { numRuns: 120 },
    );
  });

  it("places lower strict partitions in earlier ranks", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const graph = graphOf(c.count, c.edges, c.bands);
        const result = rank(graph, optionsWith("strict"));
        graph.nodes.forEach((u) => {
          graph.nodes.forEach((v) => {
            if ((u.partition ?? 0) < (v.partition ?? 0)) {
              expect(rankOf(result, u.id)).toBeLessThan(rankOf(result, v.id));
            }
          });
        });
      }),
      { numRuns: 120 },
    );
  });

  it("gives the same ranks and reversed edges for the same input", () => {
    fc.assert(
      fc.property(caseArb, modeArb, (c, mode) => {
        const graph = graphOf(c.count, c.edges, c.bands);
        const options = optionsWith(mode);
        const first = rank(graph, options);
        const second = rank(graph, options);
        expect([...second.ranks]).toEqual([...first.ranks]);
        expect(second.reversed).toEqual(first.reversed);
      }),
      { numRuns: 80 },
    );
  });

  it("ignores edges of kinds that do not rank", () => {
    fc.assert(
      fc.property(caseArb, modeArb, (c, mode) => {
        const withInfo = graphOf(c.count, c.edges, c.bands);
        const rankingOnly = graphOf(
          c.count,
          c.edges.filter(([, , k]) => k !== INFO_KIND),
          c.bands,
        );
        const options = optionsWith(mode);
        expect([...rank(withInfo, options).ranks]).toEqual([
          ...rank(rankingOnly, options).ranks,
        ]);
      }),
      { numRuns: 120 },
    );
  });

  it("keeps the ranks of existing nodes when a sink joins under hints", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const graph = graphOf(c.count, dagOf(c.edges), []);
        const options = optionsWith("none");
        const before = rank(graph, options);
        const hints: LayoutHints = {
          nodes: new Map(
            Array.from(before.ranks, ([id, r]) => [
              id,
              { rank: r, order: 0, x: 0, y: 0 },
            ]),
          ),
        };
        const grown: LayoutGraph = {
          nodes: [...graph.nodes, { id: `n${c.count}`, width: 10, height: 10 }],
          edges: [
            ...graph.edges,
            { id: "grow", source: "n0", target: `n${c.count}`, kind: "light" },
          ],
        };
        const after = rank(grown, { ...options, hints });
        for (const [id, r] of before.ranks) {
          expect(after.ranks.get(id)).toBe(r);
        }
      }),
      { numRuns: 80 },
    );
  });
});
