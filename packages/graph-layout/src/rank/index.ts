import { reversedEdges } from "../acyclic.js";
import { type Budget, budgetOf } from "../budget.js";
import type {
  LayoutGraph,
  LayoutHints,
  LayoutNode,
  LayoutOptions,
} from "../types.js";
import {
  type Extension,
  hintConstraints,
  partitionConstraints,
} from "./constraints.js";
import { type NetworkEdge, networkSimplex } from "./networkSimplex.js";

/** Each node's rank (lowest at 0) and the ids of ranking edges that the ranking lays out against their direction. */
export interface RankResult {
  ranks: ReadonlyMap<string, number>;
  reversed: readonly string[];
  /** The run's budget, which the later phases read their counts from. */
  budget: Budget;
}

/** A ranking edge in the direction it is ranked, which can differ from its source and target. */
interface RankingEdge {
  id: string;
  from: string;
  to: string;
  minLength: number;
  weight: number;
  reversed: boolean;
}

/**
 * Chooses the ranks of the nodes: the weighted length of the ranking edges is least, every ranking edge spans its
 * minimum length, and the partitions and the hints of `options` hold as far as they are asked to. Only edge kinds
 * whose policy ranks take part. Under strict partitions an edge that points back across bands is ranked backwards.
 */
export function rank(
  graph: LayoutGraph,
  options: LayoutOptions,
  budget: Budget = budgetOf(options),
): RankResult {
  if (graph.nodes.length === 0) {
    return { ranks: new Map(), reversed: [], budget };
  }
  const mode = options.partitions ?? "soft";
  const edges = rankingEdges(graph, options, mode === "strict");
  breakCycles(edges);
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const at = (id: string): number => index.get(id) ?? 0;
  const network: NetworkEdge[] = edges.map((e) => ({
    tail: at(e.from),
    head: at(e.to),
    minLength: e.minLength,
    weight: e.weight,
  }));
  const bands: Extension =
    mode === "none"
      ? { count: graph.nodes.length, edges: [] }
      : partitionConstraints(
          graph.nodes.map((node) =>
            mode === "strict" ? (node.partition ?? 0) : node.partition,
          ),
          mode,
        );
  const stability = options.stability ?? 1;
  const hints = hintConstraints(
    bands.count,
    hintRanks(graph.nodes, options.hints, stability),
    stability,
  );
  const cap = budget.rankPivots;
  const ranks = networkSimplex(
    hints.count,
    [...network, ...bands.edges, ...hints.edges],
    cap,
  );
  return { ...normalise(graph.nodes, edges, ranks), budget };
}

/** The ranking edges, oriented: an edge of a kind that does not rank, or a self-loop, takes no part. */
function rankingEdges(
  graph: LayoutGraph,
  options: LayoutOptions,
  strict: boolean,
): RankingEdge[] {
  // Under strict a node in no partition joins the first band: a free node on a path that runs back across bands
  // would leave no ranking that keeps the bands in order.
  const bandOf = new Map(
    graph.nodes.map((node) => [node.id, node.partition ?? 0]),
  );
  const backwardAcross = (from: string, to: string): boolean =>
    (bandOf.get(from) ?? 0) > (bandOf.get(to) ?? 0);
  return graph.edges.flatMap((e) => {
    const policy = options.edgeKinds[e.kind];
    if (policy === undefined || !policy.ranks || e.source === e.target) {
      return [];
    }
    const backward = strict && backwardAcross(e.source, e.target);
    return [
      {
        id: e.id,
        from: backward ? e.target : e.source,
        to: backward ? e.source : e.target,
        minLength: policy.minLength ?? 1,
        weight: policy.weight ?? 1,
        reversed: backward,
      },
    ];
  });
}

/** Flips the edges that Eades, Lin and Smyth's heuristic reports, so the ranking graph has no cycle. */
function breakCycles(edges: RankingEdge[]): void {
  const cut = new Set(
    reversedEdges(
      edges.map((e) => ({ id: e.id, source: e.from, target: e.to })),
    ),
  );
  for (const e of edges) {
    if (cut.has(e.id)) {
      [e.from, e.to] = [e.to, e.from];
      e.reversed = !e.reversed;
    }
  }
}

/** The hint of each node, or nothing when the hints do not apply: no hints, or a stability of zero. */
function hintRanks(
  nodes: readonly LayoutNode[],
  hints: LayoutHints | undefined,
  stability: number,
): (number | undefined)[] {
  if (hints === undefined || stability <= 0) {
    return [];
  }
  return nodes.map((node) => hints.nodes.get(node.id)?.rank);
}

/** Shifts the ranks so the lowest real node is at 0, and lists the reversed edges in input order. */
function normalise(
  nodes: readonly LayoutNode[],
  edges: readonly RankingEdge[],
  ranks: readonly number[],
): Omit<RankResult, "budget"> {
  const real = ranks.slice(0, nodes.length);
  const low = real.reduce((m, r) => Math.min(m, r), Infinity);
  const shifted = new Map<string, number>();
  nodes.forEach((node, i) => {
    shifted.set(node.id, real[i]! - low);
  });
  return {
    ranks: shifted,
    reversed: edges.filter((e) => e.reversed).map((e) => e.id),
  };
}
