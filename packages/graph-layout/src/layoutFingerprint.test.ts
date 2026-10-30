import { expect, it } from "vitest";
import { layout } from "./layout.js";
import { seededRandom } from "./random.js";
import type {
  LayoutCluster,
  LayoutEdge,
  LayoutGraph,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
} from "./types.js";

// Golden: the whole `layout()` output (nodes, edges, clusters, partitions, bounds, metrics, hints) on a fixed corpus of
// seeded graphs. The corpus covers rows and levels, both directions, transparent and opaque clusters (nested), ports,
// cyclic graphs with back edges and self-loops, column edges, every partition mode (none, soft, strict), hints fed back
// from a previous run, and each effort. One FNV-1a fingerprint per effort and setting covers every graph, so a refactor
// that must keep output bit-identical keeps these values. The JSON writes -0 as "-0", so a sign-of-zero change also
// changes a fingerprint. A deliberate change to layout output updates the values.

const FINGERPRINTS: Record<string, string> = {
  "fast/down/rows": "729a2d26",
  "fast/down/levels": "45724331",
  "fast/right/rows": "7853028a",
  "fast/right/levels": "3ffb2a24",
  "fast/hinted": "8019d53d",
  "balanced/down/rows": "dbfb0c72",
  "balanced/down/levels": "bb57b10b",
  "balanced/right/rows": "1b53da20",
  "balanced/right/levels": "03dd3e2f",
  "balanced/hinted": "8cf10c09",
  "thorough/down/rows": "644aabf9",
  "thorough/down/levels": "e6f5458b",
  "thorough/right/rows": "8d9c1efd",
  "thorough/right/levels": "1d789e1c",
  "thorough/hinted": "08e22c74",
};

type Effort = "fast" | "balanced" | "thorough";
type Partitions = "none" | "soft" | "strict";

const EFFORTS: readonly Effort[] = ["fast", "balanced", "thorough"];

/** Every partition mode, rotated across the corpus so each graph set sees all three. */
const PARTITIONS: readonly Partitions[] = ["none", "soft", "strict"];

/** Small graphs (for the stage logic) and large ones (where the work bounds bind), in one list. */
const SIZES = [
  9, 14, 6, 11, 9, 17, 4, 12, 9, 8, 13, 9, 10, 7, 9, 15, 5, 9, 12, 9, 9, 16, 10,
  9, 8, 9, 11, 9, 9, 13, 9, 9, 10, 6, 9, 9, 12, 9, 9, 9, 90, 120, 160,
];

/**
 * A seeded graph of `count` nodes. Variant `v` picks what the graph carries: 0 nothing extra, 1 transparent clusters,
 * 2 opaque clusters, 3 opaque clusters with partitions. Every node has an east port `out` and a west port `in`, and
 * about half the edges name them. Edges join random pairs in either order, so the graph has back edges and cycles, and
 * a quarter of the self-loops survive. A fifth of the edges are column edges that do not rank.
 */
function corpusGraph(
  seed: number,
  count: number,
  variant: number,
): LayoutGraph {
  const random = seededRandom(seed);
  const pick = (n: number) => Math.floor(random() * n);
  const nodes = Array.from({ length: count }, (_, i): LayoutNode => {
    const member = pick(5);
    const height = 30 + pick(50);
    return {
      id: `n${i}`,
      width: 60 + pick(90),
      height,
      ports: [
        { id: "out", side: "east", offset: Math.floor(height / 2) },
        { id: "in", side: "west", offset: 4 },
      ],
      ...(variant >= 1 && member < 4 ? { cluster: `c${member}` } : {}),
      ...(variant === 3 ? { partition: pick(3) } : {}),
    };
  });
  const edges: LayoutEdge[] = [];
  const wanted = Math.floor(count * 1.25);
  for (let e = 0; e < wanted; e++) {
    const a = pick(count);
    const b = pick(count);
    if (a === b && pick(4) !== 0) {
      continue;
    }
    edges.push({
      id: `e${e}`,
      source: `n${a}`,
      target: `n${b}`,
      kind: pick(5) === 0 ? "column" : "dependency",
      ...(pick(2) === 0 ? { sourcePort: "out" } : {}),
      ...(pick(2) === 0 ? { targetPort: "in" } : {}),
    });
  }
  const clusters: LayoutCluster[] = [
    { id: "c0" },
    { id: "c1", parent: "c0" },
    { id: "c2" },
    { id: "c3", parent: "c2" },
  ].map((cluster) => ({
    ...cluster,
    padding: 8 + pick(20),
    labelHeight: pick(20),
    ...(variant >= 2 ? { opaque: true } : {}),
  }));
  return variant === 0 ? { nodes, edges } : { nodes, edges, clusters };
}

const CORPUS: LayoutGraph[] = SIZES.map((count, i) =>
  corpusGraph(1000 + i, count, i % 4),
);

const KINDS = {
  dependency: { ranks: true, weight: 1 },
  column: { ranks: false, weight: 0.5 },
};

function optionsOf(run: {
  effort: Effort;
  direction: "down" | "right";
  ranks: "rows" | "levels";
  partitions: Partitions;
}): LayoutOptions {
  return { ...run, edgeKinds: KINDS };
}

/** The JSON text of a result, with -0 written as "-0" so that a sign change shows. */
function textOf(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    Object.is(v, -0) ? "-0" : v,
  );
}

/** FNV-1a, 32 bits, over the UTF-16 code units of `text`. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function fingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const effort of EFFORTS) {
    for (const direction of ["down", "right"] as const) {
      for (const ranks of ["rows", "levels"] as const) {
        const cases = CORPUS.map((graph, i) =>
          layout(
            graph,
            optionsOf({
              effort,
              direction,
              ranks,
              partitions: PARTITIONS[i % PARTITIONS.length] ?? "none",
            }),
          ),
        );
        out[`${effort}/${direction}/${ranks}`] = fingerprint(textOf(cases));
      }
    }
    // Hints: each graph is laid out once, then again with the first run's hints, at stability 1.
    const hinted: LayoutResult[] = CORPUS.map((graph, i) => {
      const first = layout(
        graph,
        optionsOf({
          effort,
          direction: "down",
          ranks: "rows",
          partitions: PARTITIONS[i % PARTITIONS.length] ?? "none",
        }),
      );
      return layout(graph, {
        ...optionsOf({
          effort,
          direction: "right",
          ranks: "levels",
          partitions: "strict",
        }),
        hints: first.hints,
        stability: 1,
      });
    });
    out[`${effort}/hinted`] = fingerprint(textOf(hinted));
  }
  return out;
}

it("keeps layout output bit-identical on the seeded corpus", () => {
  expect(fingerprints()).toEqual(FINGERPRINTS);
}, 600_000);
