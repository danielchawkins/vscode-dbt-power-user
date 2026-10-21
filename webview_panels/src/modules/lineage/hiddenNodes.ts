import type { lineage } from "@fusion-power-user/webview-contract";

/**
 * The IDs of the tables whose edges are not drawn: each known table the host marks hidden, except the start table,
 * which is never hidden. A hidden table can still be drawn; only its edges are left out.
 */
export function hiddenTables(graph: {
  known: Record<string, lineage.LineageTable>;
  start?: string | undefined;
}): Set<string> {
  return new Set(
    Object.values(graph.known)
      .filter((table) => table.hidden && table.table !== graph.start)
      .map((table) => table.table),
  );
}
