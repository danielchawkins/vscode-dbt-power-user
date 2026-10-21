import type { lineage } from "@fusion-power-user/webview-contract";
import type { Edge, Node } from "@xyflow/react";
import type { TitleMode } from "./card";
import type { GroupChip, GroupView } from "./expansionGroups";
import { expansionKey } from "./graph";
import { columnHandle, geometry, layout, tableHeight } from "./layout";

/** What a table node draws; `columns` is undefined while the list is hidden. */
interface TableNodeData extends Record<string, unknown> {
  table: lineage.LineageTable;
  columns?: lineage.LineageColumn[] | undefined;
  isStart: boolean;
  /** Whether the card is titled by alias or by dbt name. */
  title: TitleMode;
  expanded: { parents: boolean; children: boolean };
  /** Expansions still loading; a click on one cancels it. */
  pending: { parents: boolean; children: boolean };
  /** Neighbours a capped expansion does not draw yet. */
  hidden: { parents: number; children: number };
  /** The open groups this table's expansions drew, each with a chip to close it. */
  chips: GroupChip[];
  /** Lower-cased names of this table's columns the traced edges touch. */
  traced: string[];
  /** The selected column's lower-cased name when it belongs to this table. */
  selectedColumn?: string | undefined;
  errors?: string[] | undefined;
  columnsNeedStrict?: boolean | undefined;
}

export type TableNode = Node<TableNodeData, "table">;

/** What a group node draws: the bucket's label and how many neighbours it stands for. */
interface GroupNodeData extends Record<string, unknown> {
  label: string;
  count: number;
}

export type GroupNode = Node<GroupNodeData, "group">;

/** What `toFlow` reads besides the drawn data. */
export interface FlowInput {
  /** How cards are titled; absent means by alias. */
  title?: TitleMode | undefined;
  data: lineage.LineageData;
  columns: Record<string, lineage.LineageColumn[]>;
  columnTables: readonly string[];
  expansions: readonly string[];
  /** Expansion keys still loading. */
  pending?: readonly string[] | undefined;
  /** Neighbours each capped expansion does not draw yet, by expansion key. */
  hidden?: Record<string, number> | undefined;
  /** Closed groups of applied expansions, each drawn as one card. */
  groups?: readonly GroupView[] | undefined;
  /** The `[parent, child]` pairs joining each group to its table. */
  groupEdges?: readonly [string, string][] | undefined;
  /** The open groups to chip on their expanded tables. */
  chips?: readonly GroupChip[] | undefined;
  errors: Record<string, string[]>;
  selectedTable?: string | undefined;
  selectedColumn?: [string, string] | undefined;
  refs: readonly lineage.LineageRef[];
  /** Empty column lists explain that strict static analysis is missing. */
  columnsNeedStrict?: boolean | undefined;
}

/** Lower-cased column names per table that `columnEdges` touch. */
function tracedColumns(
  columnEdges: readonly lineage.ColumnLineage[],
): Map<string, Set<string>> {
  const traced = new Map<string, Set<string>>();
  for (const e of columnEdges) {
    for (const [table, column] of [e.source, e.target]) {
      const columns = traced.get(table) ?? new Set<string>();
      traced.set(table, columns);
      columns.add(column.toLowerCase());
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
  const handle = (side: "in" | "out", [table, column]: [string, string]) => {
    const match = listed(table)?.find(
      (c) => c.name.toLowerCase() === column.toLowerCase(),
    );
    return match ? columnHandle(side, match.name) : side;
  };
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
    ...(input.groupEdges ?? []).map(([parent, child]) => ({
      id: `g:${parent}->${child}`,
      source: parent,
      target: child,
      sourceHandle: "out",
      targetHandle: "in",
      className: "lineage-table-edge",
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

/** React Flow nodes and edges for the drawn lineage and its groups, laid out by dagre. */
export function toFlow(input: FlowInput): {
  nodes: (TableNode | GroupNode)[];
  edges: Edge[];
} {
  const { data, columns, columnTables, expansions, errors } = input;
  const pending = input.pending ?? [];
  const groups = input.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const chipsByTable = Map.groupBy(input.chips ?? [], (chip) => chip.table);
  const chipsOf = (table: string) => chipsByTable.get(table) ?? [];
  const hidden = (direction: "children" | "parents", table: string) =>
    input.hidden?.[expansionKey(direction, table)] ?? 0;
  const listed = (table: string) =>
    columnTables.includes(table) ? (columns[table] ?? []) : undefined;
  const traced = tracedColumns(data.columnEdges);
  const positions = layout(
    [...data.tables.map((t) => t.table), ...groups.map((g) => g.id)],
    [...data.edges, ...(input.groupEdges ?? [])],
    (id) =>
      groupIds.has(id)
        ? geometry.groupHeight
        : tableHeight(listed(id), chipsOf(id).length),
  );
  const tableNodes: TableNode[] = data.tables.map((t) => ({
    id: t.table,
    type: "table",
    position: positions.get(t.table) ?? { x: 0, y: 0 },
    // A size before React Flow measures the node, so the minimap draws it at once; measurement still sets handles.
    initialWidth: geometry.tableWidth,
    initialHeight: tableHeight(listed(t.table), chipsOf(t.table).length),
    selected: t.table === input.selectedTable,
    data: {
      table: t,
      columns: listed(t.table),
      isStart: t.table === data.start,
      title: input.title ?? "alias",
      expanded: {
        parents: expansions.includes(expansionKey("parents", t.table)),
        children: expansions.includes(expansionKey("children", t.table)),
      },
      pending: {
        parents: pending.includes(expansionKey("parents", t.table)),
        children: pending.includes(expansionKey("children", t.table)),
      },
      hidden: {
        parents: hidden("parents", t.table),
        children: hidden("children", t.table),
      },
      chips: chipsOf(t.table),
      traced: [...(traced.get(t.table) ?? [])],
      selectedColumn:
        input.selectedColumn?.[0] === t.table
          ? input.selectedColumn[1].toLowerCase()
          : undefined,
      errors: errors[t.table],
      columnsNeedStrict: input.columnsNeedStrict,
    },
  }));
  const groupNodes: GroupNode[] = groups.map((g) => ({
    id: g.id,
    type: "group",
    position: positions.get(g.id) ?? { x: 0, y: 0 },
    initialWidth: geometry.tableWidth,
    initialHeight: geometry.groupHeight,
    data: { label: g.label, count: g.count },
  }));
  return {
    nodes: [...tableNodes, ...groupNodes],
    edges: toEdges(input, listed),
  };
}
