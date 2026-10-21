import dagre from "@dagrejs/dagre";

/** Node geometry the layout and the stylesheet share, in pixels. */
export const geometry = {
  tableWidth: 280,
  headerHeight: 56,
  groupHeight: 56,
  actionsHeight: 28,
  chipRowHeight: 24,
  columnHeight: 24,
  listPadding: 8,
  rankGap: 160,
  nodeGap: 40,
};

/**
 * The height of a table node: its header, its actions row, `chips` group chips two to a row, and `columns` when
 * listed. An empty list keeps one row for its message.
 */
export const tableHeight = (
  columns: readonly unknown[] | undefined,
  chips: number,
): number =>
  geometry.headerHeight +
  geometry.actionsHeight +
  Math.ceil(chips / 2) * geometry.chipRowHeight +
  (columns
    ? geometry.listPadding + Math.max(columns.length, 1) * geometry.columnHeight
    : 0);

/** Top-left corner of each node `ids`, laid out left to right from parents to children by dagre. */
export function layout(
  ids: readonly string[],
  edges: readonly [string, string][],
  heightOf: (id: string) => number,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranksep: geometry.rankGap,
    nodesep: geometry.nodeGap,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of ids) {
    g.setNode(id, {
      width: geometry.tableWidth,
      height: heightOf(id),
    });
  }
  for (const [parent, child] of edges) {
    g.setEdge(parent, child);
  }
  dagre.layout(g);
  // dagre positions node centres.
  return new Map(
    ids.map((id) => {
      const n = g.node(id) as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      return [id, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];
    }),
  );
}

/** The handle ID of `column` on the given side of its table node. */
export const columnHandle = (side: "in" | "out", column: string): string =>
  `${side}:${column}`;
