import type { lineage } from "@fusion-power-user/webview-contract";
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
import type { GroupChip, GroupView } from "./expansionGroups";
import { expansionKey } from "./graph";
import { layeredFlow, type LayeredColumnEdge } from "./layeredFlow";
import { type LayeredNode, type Point } from "./layeredMetrics";
import { bandColour, dominantTag, layerTagOf, OTHER_TAG } from "./layerTags";
import {
  columnHandle,
  columnRowOffset,
  geometry,
  layout,
  tableHeight,
} from "./layout";
import { relationshipPath } from "./relationshipRoute";

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
  /** The layered layout: table edges enter on the top bubble and leave by the bottom one. */
  layered?: boolean | undefined;
  /** The colour of the card's layer stripe: its band's colour. */
  layerColour: string;
}

export type TableNode = Node<TableNodeData, "table">;

/** What a group node draws: the bucket's label and how many neighbours it stands for. */
interface GroupNodeData extends Record<string, unknown> {
  label: string;
  count: number;
  /** The layered layout: the group's edges enter on the top bubble and leave by the bottom one. */
  layered?: boolean | undefined;
}

export type GroupNode = Node<GroupNodeData, "folderGroup">;

/** A layer band drawn behind the cards: the layer's tag, its label and its colour. */
interface BandNodeData extends Record<string, unknown> {
  tag: string;
  colour: string;
}

export type BandNode = Node<BandNodeData, "band">;

/** A layered edge's routed path, from the gutter router. */
export interface RoutedEdgeData extends Record<string, unknown> {
  d: string;
  labelAt: Point;
  start: Point;
  end: Point;
}

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
  /** Which connections are drawn: table and group edges under `dbt` and `both`; absent means dbt dependencies. */
  connections?: lineage.Connections | undefined;
  /** The relationships to draw, already filtered for the connections and the sources. */
  refs: readonly lineage.LineageRef[];
  /** Empty column lists explain that strict static analysis is missing. */
  columnsNeedStrict?: boolean | undefined;
  /** Card placement; absent means `layered`. */
  layout?: lineage.LineageLayout | undefined;
  /** `lineage.layerColors`: a colour per layer tag over the theme palette. */
  layerColors?: Readonly<Record<string, string>> | undefined;
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

/** Table and group edges are drawn under `dbt` and `both`; under `declared` only relationships and column edges are. */
const drawsTableEdges = (input: FlowInput): boolean =>
  input.connections !== "declared";

/**
 * The `[parent, child]` pairs that rank the cards top-down or left to right. Under `declared` no table edge is drawn,
 * so the relationships rank the cards, the referenced table upstream of the declaring one.
 */
function rankingEdges(input: FlowInput): [string, string][] {
  return drawsTableEdges(input)
    ? [...input.data.edges, ...(input.groupEdges ?? [])]
    : input.refs.map((ref) => [ref.to.table, ref.from.table]);
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

/**
 * The layered placement: every card and band position, and the routed path of every edge. The edge ids are the ones
 * `toEdges` gives, so each edge finds its path by id.
 */
function placeLayered(
  input: FlowInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  heightOf: (id: string) => number,
): {
  positions: Map<string, Point>;
  bands: BandNode[];
  paths: Map<string, RoutedEdgeData>;
} {
  const { data } = input;
  const groupsOf = input.groups ?? [];
  const tagOf = new Map(
    data.tables.map((t) => [t.table, layerTagOf(t.nodeType, t.layer)] as const),
  );
  const anchorTag = (group: GroupView) => {
    const anchor = group.edge[0] === group.id ? group.edge[1] : group.edge[0];
    return tagOf.get(anchor) ?? OTHER_TAG;
  };
  const nodes: LayeredNode[] = [
    ...data.tables.map((t) => ({
      id: t.table,
      width: geometry.tableWidth,
      height: heightOf(t.table),
      tag: layerTagOf(t.nodeType, t.layer),
    })),
    ...groupsOf.map((g) => ({
      id: g.id,
      width: geometry.tableWidth,
      height: geometry.groupHeight,
      tag:
        g.layerTags && g.layerTags.length > 0
          ? dominantTag(g.layerTags)
          : anchorTag(g),
    })),
  ];
  const known = new Set(nodes.map((node) => node.id));
  const both = (parent: string, child: string) =>
    known.has(parent) && known.has(child);
  const offsetOf = (table: string, column: [string, string]) => {
    const index = (listed(table) ?? []).findIndex((c) =>
      sameColumnName(c, column[1]),
    );
    if (index < 0) {
      return geometry.headerHeight / 2;
    }
    const pinned = table === data.start || table === input.selectedTable;
    return columnRowOffset(
      index,
      input.chips?.filter((c) => c.table === table).length ?? 0,
      pinned,
    );
  };
  const tableEdges = drawsTableEdges(input);
  const tableRoutes = [
    ...(tableEdges ? data.edges : []).map(([parent, child]) => ({
      id: tableEdgeId(parent, child),
      parent,
      child,
    })),
    ...(tableEdges ? (input.groupEdges ?? []) : []).map(([parent, child]) => ({
      id: groupEdgeId(parent, child),
      parent,
      child,
    })),
  ].filter((route) => both(route.parent, route.child));
  const columnRoutes: LayeredColumnEdge[] = data.columnEdges
    .filter((e) => known.has(e.source[0]) && known.has(e.target[0]))
    .map((e) => ({
      id: columnEdgeId(e.source, e.target),
      from: e.source[0],
      fromOffset: offsetOf(e.source[0], e.source),
      to: e.target[0],
      toOffset: offsetOf(e.target[0], e.target),
    }));
  const relationshipRoutes = input.refs
    .filter((ref) => both(ref.from.table, ref.to.table))
    .map((ref) => ({
      id: relationshipEdgeId(ref.id),
      from: ref.from.table,
      to: ref.to.table,
    }));
  const flow = layeredFlow({
    start: data.start ?? "",
    nodes,
    tableRoutes,
    rankEdges: rankingEdges(input).filter(([parent, child]) =>
      both(parent, child),
    ),
    columnRoutes,
    relationshipRoutes,
    traceOn: data.columnEdges.length > 0,
  });
  const bands: BandNode[] = flow.bands.map((band, index) => ({
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
    data: { tag: band.tag, colour: bandColour(band.tag, input.layerColors) },
  }));
  const paths = new Map<string, RoutedEdgeData>();
  for (const [id, path] of flow.paths) {
    paths.set(id, {
      d: path.d,
      labelAt: path.labelAt,
      start: path.start,
      end: path.end,
      startsAt: path.startsAt,
    });
  }
  return { positions: flow.positions, bands, paths };
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

/** React Flow nodes and edges for the drawn lineage and its groups: layered by default, or dagre left to right. */
export function toFlow(input: FlowInput): {
  nodes: (TableNode | GroupNode | BandNode)[];
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
  const layered = (input.layout ?? "layered") === "layered";
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
  const placed = layered ? placeLayered(input, listed, heightOf) : undefined;
  const positions =
    placed?.positions ??
    layout(
      [...data.tables.map((t) => t.table), ...groups.map((g) => g.id)],
      rankingEdges(input),
      heightOf,
    );
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
      errors: errors[t.table],
      columnsNeedStrict: input.columnsNeedStrict,
      layered,
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
    data: { label: g.label, count: g.count, layered },
  }));
  const edges = toEdges(input, listed);
  if (!placed) {
    return { nodes: [...tableNodes, ...groupNodes], edges };
  }
  // Layered edges are drawn from the router's paths; an edge the router did not route is not drawn.
  const routed = edges.flatMap((edge): Edge[] => {
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
  return {
    nodes: [...placed.bands, ...tableNodes, ...groupNodes],
    edges: routed,
  };
}

/** The edges React Flow draws: below the semantic-zoom threshold, column edges are left out; the layout still routes them. */
export function drawnEdges(edges: Edge[], zoomedOut: boolean): Edge[] {
  return zoomedOut ? edges.filter((e) => !isColumnEdgeId(e.id)) : edges;
}
