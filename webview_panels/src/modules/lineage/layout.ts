import dagre from "@dagrejs/dagre";
import type { lineage } from "@fusion-power-user/webview-contract";

type LineageTable = lineage.LineageTable;

/** Node geometry the layout and the stylesheet share, in pixels. */
export const geometry = {
  tableWidth: 280,
  headerHeight: 56,
  actionsHeight: 28,
  columnHeight: 24,
  listPadding: 8,
  rankGap: 160,
  nodeGap: 40,
};

/** The height of a table node, listing `columns` when given; an empty list keeps one row for its message. */
export const tableHeight = (columns?: readonly unknown[]): number =>
  geometry.headerHeight +
  geometry.actionsHeight +
  (columns
    ? geometry.listPadding + Math.max(columns.length, 1) * geometry.columnHeight
    : 0);

/** Top-left corner of each table, laid out left to right from parents to children by dagre. */
export function layout(
  tables: readonly LineageTable[],
  edges: readonly [string, string][],
  heightOf: (table: string) => number,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: geometry.rankGap,
    nodesep: geometry.nodeGap,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const t of tables) {
    g.setNode(t.table, {
      width: geometry.tableWidth,
      height: heightOf(t.table),
    });
  }
  for (const [parent, child] of edges) {
    g.setEdge(parent, child);
  }
  dagre.layout(g);
  // dagre positions node centres.
  return new Map(
    tables.map((t) => {
      const n = g.node(t.table) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return [t.table, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];
    }),
  );
}

/** The handle ID of `column` on the given side of its table node. */
export const columnHandle = (side: "in" | "out", column: string): string =>
  `${side}:${column}`;
