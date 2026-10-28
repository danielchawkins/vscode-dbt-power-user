import type { LayoutOptions } from "./types.js";

/**
 * Options a preset may set. `direction`, `edgeKinds`, `anchor` and `hints` describe one graph, so a preset leaves
 * them to the caller: a preset is the same plain object for every graph.
 */
export type LayoutPreset = Partial<
  Omit<LayoutOptions, "direction" | "edgeKinds" | "anchor" | "hints">
>;

/**
 * Named option sets. A caller merges one with its own options and calls `layout` again; nothing is remembered between
 * calls. The values are starting points; the evaluation harness tunes them against golden graphs.
 */
export const layoutPresets = {
  /** Orthogonal drawing with few crossings: the ordering phase searches hardest and nodes sit closer. */
  circuit: {
    effort: "thorough",
    partitions: "soft",
    spacing: { node: 12, rank: 28, edge: 4, cluster: 10 },
  },
  /** Orthogonal drawing packed into the least area: a quick search and tight spacing. */
  compact: {
    effort: "fast",
    partitions: "soft",
    spacing: { node: 8, rank: 20, edge: 3, cluster: 8 },
  },
} satisfies Readonly<Record<string, LayoutPreset>>;

export type LayoutPresetName = keyof typeof layoutPresets;
