import type { lineage } from "@fusion-power-user/webview-contract";
import type { Edge, Node } from "@xyflow/react";
import { columnHandle, geometry, layout, tableHeight } from "./graph";

/** What a table node draws; `columns` is undefined while the list is hidden. */
interface TableNodeData extends Record<string, unknown> {
  table: lineage.LineageTable;
  columns?: lineage.LineageColumn[];
  isStart: boolean;
  expanded: { parents: boolean; children: boolean };
  /** Lower-cased names of this table's columns the traced edges touch. */
  traced: string[];
  /** The selected column's lower-cased name when it belongs to this table. */
  selectedColumn?: string;
  errors?: string[];
}

export type TableNode = Node<TableNodeData, "table">;

/** What `toFlow` reads besides the drawn data. */
export interface FlowInput {
  data: lineage.LineageData;
  columns: Record<string, lineage.LineageColumn[]>;
  columnTables: readonly string[];
  expansions: readonly string[];
  errors: Record<string, string[]>;
  selectedTable?: string;
  selectedColumn?: [string, string];
  refs: readonly lineage.LineageRef[];
}

/** Lower-cased column names per table that `columnEdges` touch. */
function tracedColumns(
  columnEdges: readonly lineage.ColumnLineage[],
): Map<string, Set<string>> {
  const traced = new Map<string, Set<string>>();
  for (const e of columnEdges) {
    for (const [table, column] of [e.source, e.target]) {
      (traced.get(table) ?? traced.set(table, new Set()).get(table)!).add(
        column.toLowerCase(),
      );
    }
  }
  return traced;
}

/** React Flow edges: table edges, column edges anchored to listed columns, and relationships. */
function toEdges(
  input: FlowInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
): Edge[] {
  const { data, selectedTable } = input;
  const handle = (side: "in" | "out", [table, column]: [string, string]) =>
    listed(table)?.some((c) => c.name.toLowerCase() === column.toLowerCase())
      ? columnHandle(side, column)
      : side;
  const touchesSelection = (a: string, b: string) =>
    selectedTable !== undefined && (a === selectedTable || b === selectedTable);
  return [
    ...data.edges.map(([parent, child]) => ({
      id: `t:${parent}->${child}`,
      source: parent,
      target: child,
      sourceHandle: "out",
      targetHandle: "in",
      className: touchesSelection(parent, child)
        ? "lineage-table-edge lineage-table-edge-selected"
        : "lineage-table-edge",
    })),
    ...data.columnEdges.map((e) => ({
      id: `c:${e.source.join(".")}->${e.target.join(".")}`,
      source: e.source[0],
      target: e.target[0],
      sourceHandle: handle("out", e.source),
      targetHandle: handle("in", e.target),
      className:
        e.type === "indirect"
          ? "lineage-column-edge indirect"
          : "lineage-column-edge",
    })),
    ...input.refs.map((ref) => ({
      id: `r:${ref.id}`,
      source: ref.from.table,
      target: ref.to.table,
      sourceHandle: "out",
      targetHandle: "in",
      className: "lineage-ref-edge",
      label: `${ref.from.columns.join(", ")} → ${ref.to.columns.join(", ")}`,
    })),
  ];
}

/** React Flow nodes and edges for the drawn lineage, laid out by dagre. */
export function toFlow(input: FlowInput): {
  nodes: TableNode[];
  edges: Edge[];
} {
  const { data, columns, columnTables, expansions, errors } = input;
  const listed = (table: string) =>
    columnTables.includes(table) ? (columns[table] ?? []) : undefined;
  const traced = tracedColumns(data.columnEdges);
  const positions = layout(data.tables, data.edges, (table) =>
    tableHeight(listed(table)),
  );
  const nodes: TableNode[] = data.tables.map((t) => ({
    id: t.table,
    type: "table",
    position: positions.get(t.table) ?? { x: 0, y: 0 },
    // A size before React Flow measures the node, so the minimap draws it at once; measurement still sets handles.
    initialWidth: geometry.tableWidth,
    initialHeight: tableHeight(listed(t.table)),
    selected: t.table === input.selectedTable,
    data: {
      table: t,
      columns: listed(t.table),
      isStart: t.table === data.start,
      expanded: {
        parents: expansions.includes(`p:${t.table}`),
        children: expansions.includes(`c:${t.table}`),
      },
      traced: [...(traced.get(t.table) ?? [])],
      selectedColumn:
        input.selectedColumn?.[0] === t.table
          ? input.selectedColumn[1].toLowerCase()
          : undefined,
      errors: errors[t.table],
    },
  }));
  return { nodes, edges: toEdges(input, listed) };
}
