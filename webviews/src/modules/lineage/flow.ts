import { lineage } from "@fusion-power-user/webview-contract";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { TitleMode } from "./card";
import {
  columnEdgeId,
  groupEdgeId,
  isColumnEdgeId,
  relationshipEdgeId,
  sameColumnName,
  tableEdgeId,
} from "./edgeIds";
import { engineFor } from "./engine/engines";
import type { LayerBand, Point } from "./engine/layoutEngine";
import {
  drawsTableEdges,
  layoutRequest,
  type FlowInput,
} from "./engine/layoutRequest";
import type { GroupChip } from "./expansionGroups";
import { expansionKey } from "./graph";
import { bandColour, layerTagOf } from "./layerTags";
import { columnHandle, geometry, tableHeight } from "./layout";
import { relationshipPath } from "./relationshipRoute";
import { drawLayout } from "./routeDrawing";

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
  /** The trace in flight on this table's column: the lower-cased name, and when the trace started. */
  tracing?: { column: string; since: number } | undefined;
  errors?: string[] | undefined;
  columnsNeedStrict?: boolean | undefined;
  /** The colour of the card's layer stripe: its band's colour. */
  layerColour: string;
}

export type TableNode = Node<TableNodeData, "table">;

/** What a group node draws: the bucket's label and how many neighbours it stands for. */
interface GroupNodeData extends Record<string, unknown> {
  label: string;
  count: number;
}

export type GroupNode = Node<GroupNodeData, "folderGroup">;

/** A layer band drawn behind the cards: the layer's tag, its label and its colour. */
interface BandNodeData extends Record<string, unknown> {
  tag: string;
  colour: string;
}

export type BandNode = Node<BandNodeData, "band">;

/** An edge's routed path, from the layout engine's routing (routeDrawing.ts). */
export interface RoutedEdgeData extends Record<string, unknown> {
  d: string;
  labelAt: Point;
  start: Point;
  end: Point;
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
  // Declared-only drawing shows no dbt table or group edges; column edges remain, present only under a column trace.
  const tableEdges = drawsTableEdges(input);
  const handle = (side: "in" | "out", [table, column]: [string, string]) => {
    const match = listed(table)?.find((c) => sameColumnName(c, column));
    return match ? columnHandle(side, match.name) : side;
  };
  const touchesSelection = (a: string, b: string) =>
    selectedTable !== undefined && (a === selectedTable || b === selectedTable);
  return [
    ...(tableEdges ? data.edges : []).map(([parent, child]) => ({
      id: tableEdgeId(parent, child),
      source: parent,
      target: child,
      sourceHandle: "out",
      targetHandle: "in",
      className: touchesSelection(parent, child)
        ? "lineage-table-edge lineage-table-edge-selected"
        : "lineage-table-edge",
    })),
    ...(tableEdges ? (input.groupEdges ?? []) : []).map(([parent, child]) => ({
      id: groupEdgeId(parent, child),
      source: parent,
      target: child,
      sourceHandle: "out",
      targetHandle: "in",
      className: "lineage-table-edge",
    })),
    ...data.columnEdges.map((e) => ({
      id: columnEdgeId(e.source, e.target),
      source: e.source[0],
      target: e.target[0],
      sourceHandle: handle("out", e.source),
      targetHandle: handle("in", e.target),
      className:
        e.type === "indirect"
          ? "lineage-column-edge indirect"
          : "lineage-column-edge",
    })),
    // The referenced (one) side is the source, so it sits upstream of the declaring (many) side, as in the dbt view.
    ...input.refs.map((ref) => ({
      id: relationshipEdgeId(ref.id),
      type: "relationship",
      source: ref.to.table,
      target: ref.from.table,
      sourceHandle: "out",
      targetHandle: "in",
      data: { ref },
    })),
  ];
}

/** The React Flow band nodes: one per layer band; a band lets clicks pass through to the pane. */
function bandNodes(
  bands: LayerBand[],
  layerColors: FlowInput["layerColors"],
): BandNode[] {
  return bands.map((band, index) => ({
    id: `band:${index}`,
    type: "band",
    position: { x: band.x, y: band.y },
    width: band.width,
    height: band.height,
    selectable: false,
    draggable: false,
    connectable: false,
    focusable: false,
    // React Flow sets pointer events on a node that has a click handler; a band must let clicks reach the pane.
    style: { pointerEvents: "none" },
    data: { tag: band.tag, colour: bandColour(band.tag, layerColors) },
  }));
}

/**
 * The placement: every card and band position, and the routed path of every edge. The edge ids are the ones
 * `toEdges` gives, so each edge finds its path by id.
 */
function placeCards(
  input: FlowInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  heightOf: (id: string) => number,
): {
  positions: Map<string, Point>;
  bands: BandNode[];
  paths: Map<string, RoutedEdgeData>;
} {
  const request = layoutRequest(input, listed, heightOf);
  const response = engineFor(
    input.engine ?? lineage.DEFAULT_LINEAGE_ENGINE,
  ).layout(request);
  const { paths: drawn } = drawLayout(request, response);
  const paths = new Map<string, RoutedEdgeData>();
  for (const [id, path] of drawn) {
    paths.set(id, { ...path });
  }
  return {
    positions: new Map(response.positions),
    bands: bandNodes([...response.bands], input.layerColors),
    paths,
  };
}

/**
 * The arrowhead colour of a routed edge: the colour its stroke is drawn in, so the head matches the line. A
 * relationship edge has no arrowhead.
 */
function arrowColour(edge: Edge): string | undefined {
  if (edge.type === "relationship") {
    return undefined;
  }
  const classes = edge.className ?? "";
  if (classes.includes("lineage-column-edge")) {
    return classes.includes("indirect")
      ? "var(--lineage-indirect-stroke)"
      : "var(--lineage-column-stroke)";
  }
  if (classes.includes("lineage-table-edge-selected")) {
    return "var(--lineage-selected-stroke)";
  }
  return "var(--xy-edge-stroke)";
}

/** React Flow nodes and edges for the drawn lineage and its groups: the cards in their layer bands, and the routed edges. */
export function toFlow(input: FlowInput): {
  nodes: (TableNode | GroupNode | BandNode)[];
  edges: Edge[];
} {
  const { data, columns, columnTables } = input;
  const groups = input.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const chipsByTable = Map.groupBy(input.chips ?? [], (chip) => chip.table);
  const chipsOf = (table: string) => chipsByTable.get(table) ?? [];
  const listed = (table: string) =>
    columnTables.includes(table) ? (columns[table] ?? []) : undefined;
  // One height per table, for the layout and for the initial size: the start card and the selected card show their
  // relation line and actions row.
  const heightOfTable = (table: string) =>
    tableHeight(
      listed(table),
      chipsOf(table).length,
      table === data.start || table === input.selectedTable,
    );
  const heightOf = (id: string) =>
    groupIds.has(id) ? geometry.groupHeight : heightOfTable(id);
  const placed = placeCards(input, listed, heightOf);
  const nodes = cardNodes(input, {
    positions: placed.positions,
    listed,
    heightOfTable,
  });
  const edges = toEdges(input, listed);
  return {
    nodes: [...placed.bands, ...nodes],
    edges: routedEdges(edges, placed),
  };
}

/** Where `toFlow` placed the cards and how it sizes them, for `cardNodes`. */
interface CardPlacement {
  positions: Map<string, Point>;
  listed: (table: string) => lineage.LineageColumn[] | undefined;
  heightOfTable: (table: string) => number;
}

/** The table and group nodes at their positions, each with the data its card draws. */
function cardNodes(
  input: FlowInput,
  { positions, listed, heightOfTable }: CardPlacement,
): (TableNode | GroupNode)[] {
  const { data, expansions, errors } = input;
  const pending = input.pending ?? [];
  const groups = input.groups ?? [];
  const chipsByTable = Map.groupBy(input.chips ?? [], (chip) => chip.table);
  const chipsOf = (table: string) => chipsByTable.get(table) ?? [];
  const hidden = (direction: "children" | "parents", table: string) =>
    input.hidden?.[expansionKey(direction, table)] ?? 0;
  const traced = tracedColumns(data.columnEdges);
  const tableNodes: TableNode[] = data.tables.map((t) => ({
    id: t.table,
    type: "table",
    position: positions.get(t.table) ?? { x: 0, y: 0 },
    // A size before React Flow measures the node, so the minimap draws it at once; measurement still sets handles.
    initialWidth: geometry.tableWidth,
    initialHeight: heightOfTable(t.table),
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
      tracing:
        input.tracing?.column[0] === t.table
          ? {
              column: input.tracing.column[1].toLowerCase(),
              since: input.tracing.since,
            }
          : undefined,
      errors: errors[t.table],
      columnsNeedStrict: input.columnsNeedStrict,
      layerColour: bandColour(
        layerTagOf(t.nodeType, t.layer),
        input.layerColors,
      ),
    },
  }));
  const groupNodes: GroupNode[] = groups.map((g) => ({
    id: g.id,
    type: "folderGroup",
    position: positions.get(g.id) ?? { x: 0, y: 0 },
    initialWidth: geometry.tableWidth,
    initialHeight: geometry.groupHeight,
    data: { label: g.label, count: g.count },
  }));
  return [...tableNodes, ...groupNodes];
}

/** The routed edges: each is drawn on the path the router gave it, so the edges the router did not route are left out. */
function routedEdges(
  edges: Edge[],
  placed: ReturnType<typeof placeCards>,
): Edge[] {
  // Edges are drawn from the router's paths; an edge the router did not route is not drawn.
  return edges.flatMap((edge): Edge[] => {
    const path = placed.paths.get(edge.id);
    if (!path) {
      return [];
    }
    if (edge.type === "relationship") {
      // A relationship keeps its type, so its dotted line, marks and tooltip are drawn as they are off the layout.
      return [
        {
          ...edge,
          data: {
            ...edge.data,
            routed: relationshipPath(edge, path, placed.positions),
          },
        },
      ];
    }
    const colour = arrowColour(edge);
    return [
      {
        ...edge,
        type: "routed",
        ...(colour
          ? { markerEnd: { type: MarkerType.ArrowClosed, color: colour } }
          : {}),
        data: { ...path },
      },
    ];
  });
}

/** The edges React Flow draws: below the semantic-zoom threshold, column edges are left out; the layout still routes them. */
export function drawnEdges(edges: Edge[], zoomedOut: boolean): Edge[] {
  return zoomedOut ? edges.filter((e) => !isColumnEdgeId(e.id)) : edges;
}
