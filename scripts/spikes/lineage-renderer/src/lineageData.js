/**
 * `LineageData`: what every candidate renders. It is the host's lineage answer for one starting node at the panel's
 * default expansion — the `childTables`/`parentTables` tables (`Table` with `childCount`/`parentCount`, see
 * `createTable` in src/features/lineage/dbtLineageService.ts) plus the column lineage `getConnectedColumns` returns.
 *
 * @typedef {{ name: string, data_type: string | null }} LineageColumn
 * @typedef {{ table: string, label: string, nodeType: string, childCount: number, parentCount: number,
 *   columns: LineageColumn[] }} LineageTable
 * @typedef {{ source: string, target: string }} LineageEdge
 * @typedef {{ source: [string, string], target: [string, string], type: "direct" | "indirect" }} ColumnEdge
 * @typedef {{ start: string, hops: number, tables: LineageTable[], edges: LineageEdge[],
 *   columnEdges: ColumnEdge[] }} LineageData
 */

/** Node geometry every candidate uses, so layouts compare like for like (the incumbent's `T_NODE_W`, `C_NODE_H`). */
export const geometry = { tableWidth: 300, headerHeight: 80, columnHeight: 28, columnGap: 4, padding: 12 };

/** Height of a table node that lists all its columns. */
export const tableHeight = (table) =>
  geometry.headerHeight + table.columns.length * (geometry.columnHeight + geometry.columnGap) + geometry.padding;

/** Y offset of a column row within its table node. */
export const columnY = (index) => geometry.headerHeight + index * (geometry.columnHeight + geometry.columnGap);

export const columnId = (table, column) => `${table}/${column}`;

/** Breadth-first level of each table relative to `start`: parents negative, children positive. */
export function levels(data) {
  const level = new Map([[data.start, 0]]);
  const parents = new Map();
  const children = new Map();
  for (const { source, target } of data.edges) {
    (children.get(source) ?? children.set(source, []).get(source)).push(target);
    (parents.get(target) ?? parents.set(target, []).get(target)).push(source);
  }
  for (const [map, step] of [
    [children, 1],
    [parents, -1],
  ]) {
    const queue = [data.start];
    while (queue.length) {
      const n = queue.shift();
      for (const m of map.get(n) ?? []) {
        if (!level.has(m)) {
          level.set(m, level.get(n) + step);
          queue.push(m);
        }
      }
    }
  }
  for (const t of data.tables) {
    if (!level.has(t.table)) {
      level.set(t.table, 0);
    }
  }
  return level;
}

/**
 * The incumbent's layout class (`layoutElementsOnCanvas` in the component): one column per level, tables stacked
 * by height in input order. Used by the candidates that ship no layered layout for variable-height nodes.
 * @returns {Map<string, { x: number, y: number }>} top-left corner of each table
 */
export function levelLayout(data, gapX = 280, gapY = 80) {
  const level = levels(data);
  const min = Math.min(...level.values());
  const nextY = new Map();
  const positions = new Map();
  for (const t of data.tables) {
    const l = level.get(t.table) - min;
    const y = nextY.get(l) ?? 0;
    positions.set(t.table, { x: l * (geometry.tableWidth + gapX), y });
    nextY.set(l, y + tableHeight(t) + gapY);
  }
  return positions;
}
