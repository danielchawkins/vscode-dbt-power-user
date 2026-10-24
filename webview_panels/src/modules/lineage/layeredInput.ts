import type { lineage } from "@fusion-power-user/webview-contract";
import type { TitleMode } from "./card";
import {
  columnEdgeId,
  groupEdgeId,
  relationshipEdgeId,
  sameColumnName,
  tableEdgeId,
} from "./edgeIds";
import type { GroupChip, GroupView } from "./expansionGroups";
import type { LayeredColumnEdge, LayeredFlowInput } from "./layeredFlow";
import type { LayeredNode } from "./layeredMetrics";
import { dominantTag, layerTagOf, OTHER_TAG } from "./layerTags";
import { columnRowOffset, geometry } from "./layout";

/**
 * The input of the layered layout: the cards, and the table, column and relationship routes between them. Each route
 * carries the id `toEdges` gives its edge, so the router's path finds the edge. A route with an end that is not drawn
 * is left out.
 */
export function layeredInput(
  input: FlowInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  heightOf: (id: string) => number,
): LayeredFlowInput {
  const { data } = input;
  const nodes = layeredNodes(input, heightOf);
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
  return {
    start: data.start ?? "",
    nodes,
    tableRoutes,
    rankEdges: rankingEdges(input).filter(([parent, child]) =>
      both(parent, child),
    ),
    columnRoutes,
    relationshipRoutes,
    traceOn: data.columnEdges.length > 0,
  };
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
/** Table and group edges are drawn under `dbt` and `both`; under `declared` only relationships and column edges are. */
export const drawsTableEdges = (input: FlowInput): boolean =>
  input.connections !== "declared";
/**
 * The `[parent, child]` pairs that rank the cards top-down or left to right. Under `declared` no table edge is drawn,
 * so the relationships rank the cards, the referenced table upstream of the declaring one.
 */
export function rankingEdges(input: FlowInput): [string, string][] {
  return drawsTableEdges(input)
    ? [...input.data.edges, ...(input.groupEdges ?? [])]
    : input.refs.map((ref) => [ref.to.table, ref.from.table]);
}
/** The cards the layered layout places: each table, then each open group, with the layer tag it sits in. */
function layeredNodes(
  input: FlowInput,
  heightOf: (id: string) => number,
): LayeredNode[] {
  const { data } = input;
  const groupsOf = input.groups ?? [];
  const tagOf = new Map(
    data.tables.map((t) => [t.table, layerTagOf(t.nodeType, t.layer)] as const),
  );
  const anchorTag = (group: GroupView) => {
    const anchor = group.edge[0] === group.id ? group.edge[1] : group.edge[0];
    return tagOf.get(anchor) ?? OTHER_TAG;
  };
  return [
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
}
