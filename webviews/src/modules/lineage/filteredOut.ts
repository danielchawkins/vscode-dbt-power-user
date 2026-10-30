import type { lineage } from "@fusion-power-user/webview-contract";

/**
 * The IDs of the filtered-out tables: each known table the host marks `hidden` (dbt's `meta.lineage.hidden`), except
 * the start table, which is never filtered out. A filtered-out table is still drawn as a card; only its table, group
 * and column edges are left out. The Visible Graph (`visibleOf` in graph.ts) reads this set for both the cards and the edges.
 */
export function filteredOutTables(graph: {
  known: Record<string, lineage.LineageTable>;
  start?: string | undefined;
}): Set<string> {
  return new Set(
    Object.values(graph.known)
      .filter((table) => table.hidden && table.table !== graph.start)
      .map((table) => table.table),
  );
}
