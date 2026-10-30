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
import type { EmphasisView, Pair } from "./emphasis";
import { freshLayouter, type Layouter } from "./engine/layoutCache";
import type { LayerBand, Point } from "./engine/layoutEngine";
import {
  drawsTableEdges,
  type FlowDecoration,
  layoutRequest,
  type LayoutInput,
} from "./engine/layoutRequest";
import type { GroupChip } from "./expansionGroups";
import { expansionKey } from "./graph";
import { bandColour, layerTagOf } from "./layerTags";
import { columnHandle, geometry, tableHeight } from "./layout";
import { relationshipPath } from "./relationshipRoute";
import { drawLayout } from "./routeDrawing";

/** What a table node draws; `columns` is undefined while its columns are unlisted. */
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
  capped: { parents: number; children: number };
  /** Filtered out by `meta.lineage.hidden`: the card is drawn, but its table and column edges are not. */
  filteredOut: boolean;
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
  input: LayoutInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  selectedTable: string | undefined,
): Edge[] {
  const { data } = input;
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
  layerColors: FlowDecoration["layerColors"],
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
  input: LayoutInput,
  sizes: {
    listed: (table: string) => lineage.LineageColumn[] | undefined;
    heightOf: (id: string) => number;
  },
  layouter: Layouter,
): {
  positions: Map<string, Point>;
  layerBands: LayerBand[];
  paths: Map<string, RoutedEdgeData>;
} {
  const request = layoutRequest(input, sizes.listed, sizes.heightOf);
  const response = layouter(
    request,
    input.engine ?? lineage.DEFAULT_LINEAGE_ENGINE,
  );
  const { paths: drawn } = drawLayout(request, response);
  const paths = new Map<string, RoutedEdgeData>();
  for (const [id, path] of drawn) {
    paths.set(id, { ...path });
  }
  return {
    positions: new Map(response.positions),
    layerBands: [...response.bands],
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
  if (classes.includes("lineage-path-edge")) {
    return "var(--lineage-selected-stroke)";
  }
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

/** React Flow nodes and edges as built: the layout and the decoration, with no emphasis. See `emphasize`. */
export interface BuiltFlow {
  nodes: (TableNode | GroupNode | BandNode)[];
  edges: Edge[];
}

/**
 * The `[parent, child]` pairs the panel draws: table and group edges where they are drawn, and every relationship. The
 * emphasis follows these, so a relationship edge is on a highlighted path like any other.
 */
export function drawnPairs(layout: LayoutInput): Pair[] {
  const tableEdges = drawsTableEdges(layout)
    ? [...layout.data.edges, ...(layout.groupEdges ?? [])]
    : [];
  return [
    ...tableEdges,
    ...layout.refs.map((ref): Pair => [ref.to.table, ref.from.table]),
  ];
}

/**
 * React Flow nodes and edges for the drawn lineage and its groups: the cards in their layer bands, and the routed
 * edges. The layout decides where things go; the decoration decides what they show. Emphasis is not applied here.
 */
export function toFlow(
  layout: LayoutInput,
  decoration: FlowDecoration,
  layouter: Layouter = freshLayouter,
): BuiltFlow {
  const { columns, columnTables } = layout;
  const groups = layout.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const chipsByTable = Map.groupBy(layout.chips ?? [], (chip) => chip.table);
  const chipsOf = (table: string) => chipsByTable.get(table) ?? [];
  const listed = (table: string) =>
    columnTables.includes(table) ? (columns[table] ?? []) : undefined;
  // One height per table, for the layout and for the initial size.
  const heightOfTable = (table: string) =>
    tableHeight(listed(table), chipsOf(table).length);
  const heightOf = (id: string) =>
    groupIds.has(id) ? geometry.groupHeight : heightOfTable(id);
  const placed = placeCards(layout, { listed, heightOf }, layouter);
  const nodes = cardNodes(layout, decoration, {
    positions: placed.positions,
    listed,
    heightOfTable,
  });
  const edges = toEdges(layout, listed, decoration.selectedTable);
  return {
    nodes: [...bandNodes(placed.layerBands, decoration.layerColors), ...nodes],
    edges: routedEdges(edges, placed),
  };
}

/** Where `toFlow` placed the cards and how it sizes them, for `cardNodes`. */
interface CardPlacement {
  positions: Map<string, Point>;
  listed: (table: string) => lineage.LineageColumn[] | undefined;
  heightOfTable: (table: string) => number;
}

/** The class of a card or group on the highlighted path, or dimmed off it; empty when neither applies. */
const cardClass = (view: EmphasisView, id: string): string =>
  view.dimmedCard(id)
    ? "lineage-dimmed"
    : view.pathCard(id)
      ? "lineage-path"
      : "";

/**
 * The built flow with its emphasis. Only the cards and edges the view marks are new objects; every other card and edge
 * is the same object as in `flow`, so a hover or a settings change restyles the flow and rebuilds nothing else.
 */
export function emphasize(flow: BuiltFlow, view: EmphasisView): BuiltFlow {
  return {
    nodes: flow.nodes.map((node) => emphasizedNode(node, view)),
    edges: flow.edges.map((edge) => emphasizedEdge(edge, view)),
  };
}

function emphasizedNode(
  node: BuiltFlow["nodes"][number],
  view: EmphasisView,
): BuiltFlow["nodes"][number] {
  if (node.type === "band") {
    return node;
  }
  const className = cardClass(view, node.id);
  return className === (node.className ?? "") ? node : { ...node, className };
}

/**
 * The edge with its emphasis classes: on the highlighted path, dimmed off it, or touching a hub. An edge on the path
 * is drawn in the path colour, its arrowhead too.
 */
function emphasizedEdge(edge: Edge, view: EmphasisView): Edge {
  const { source, target } = edge;
  const classes = [
    view.pathEdge(source, target) ? "lineage-path-edge" : undefined,
    view.dimmedEdge(source, target) ? "lineage-dimmed" : undefined,
    view.hubEdge(source, target) ? "lineage-hub-edge" : undefined,
  ].filter((c) => c !== undefined);
  if (classes.length === 0) {
    return edge;
  }
  const emphasized = {
    ...edge,
    className: [edge.className, ...classes].join(" ").trim(),
  };
  const colour = arrowColour(emphasized);
  return colour === undefined
    ? emphasized
    : {
        ...emphasized,
        markerEnd: { type: MarkerType.ArrowClosed, color: colour },
      };
}

/** The table and group nodes at their positions, each with the data its card draws. */
function cardNodes(
  layout: LayoutInput,
  decoration: FlowDecoration,
  { positions, listed, heightOfTable }: CardPlacement,
): (TableNode | GroupNode)[] {
  const { data } = layout;
  const { expansions, errors, selectedTable } = decoration;
  const pending = decoration.pending ?? [];
  const groups = layout.groups ?? [];
  const chipsByTable = Map.groupBy(layout.chips ?? [], (chip) => chip.table);
  const chipsOf = (table: string) => chipsByTable.get(table) ?? [];
  const capped = (direction: "children" | "parents", table: string) =>
    decoration.capped?.[expansionKey(direction, table)] ?? 0;
  const traced = tracedColumns(data.columnEdges);
  const tableNodes: TableNode[] = data.tables.map((t) => ({
    id: t.table,
    type: "table",
    position: positions.get(t.table) ?? { x: 0, y: 0 },
    // A size before React Flow measures the node, so the minimap draws it at once; measurement still sets handles.
    initialWidth: geometry.tableWidth,
    initialHeight: heightOfTable(t.table),
    selected: t.table === selectedTable,
    data: {
      table: t,
      columns: listed(t.table),
      isStart: t.table === data.start,
      title: decoration.title ?? "alias",
      expanded: {
        parents: expansions.includes(expansionKey("parents", t.table)),
        children: expansions.includes(expansionKey("children", t.table)),
      },
      pending: {
        parents: pending.includes(expansionKey("parents", t.table)),
        children: pending.includes(expansionKey("children", t.table)),
      },
      capped: {
        parents: capped("parents", t.table),
        children: capped("children", t.table),
      },
      filteredOut: decoration.filteredOut?.has(t.table) ?? false,
      chips: chipsOf(t.table),
      traced: [...(traced.get(t.table) ?? [])],
      selectedColumn:
        decoration.selectedColumn?.[0] === t.table
          ? decoration.selectedColumn[1].toLowerCase()
          : undefined,
      tracing:
        decoration.tracing?.column[0] === t.table
          ? {
              column: decoration.tracing.column[1].toLowerCase(),
              since: decoration.tracing.since,
            }
          : undefined,
      errors: errors[t.table],
      columnsNeedStrict: decoration.columnsNeedStrict,
      layerColour: bandColour(
        layerTagOf(t.nodeType, t.layer),
        decoration.layerColors,
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
