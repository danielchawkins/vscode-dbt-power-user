import type { lineage } from "@fusion-power-user/webview-contract";
import type { TitleMode } from "../card";
import {
  columnEdgeId,
  groupEdgeId,
  relationshipEdgeId,
  sameColumnName,
  tableEdgeId,
} from "../edgeIds";
import type { GroupChip, GroupView } from "../expansionGroups";
import { dominantTag, layerTagOf, OTHER_TAG } from "../layerTags";
import { columnRowOffset, geometry } from "../layout";
import type {
  LayoutCard,
  LayoutEdgeSpec,
  LayoutRequest,
  LayoutRow,
} from "./layoutEngine";

/**
 * The request the layout engine is asked: the cards, and the table, group, column and relationship edges between
 * them. Each edge carries the id `toEdges` gives it, so the routed path finds the edge. An edge with an end that is
 * not drawn is left out.
 */
export function layoutRequest(
  input: LayoutInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  heightOf: (id: string) => number,
): LayoutRequest {
  const { data } = input;
  const cards = layoutCards(input, listed, heightOf);
  const known = new Set(cards.map((card) => card.id));
  const both = (parent: string, child: string) =>
    known.has(parent) && known.has(child);
  const softened = new Set(input.softened ?? []);
  // A dependency with a softened end is drawn as a soft edge: it pulls at a low weight and ranks nothing.
  const soft = (parent: string, child: string) =>
    softened.has(parent) || softened.has(child);
  const rowOf = (table: string, column: [string, string]) =>
    (listed(table) ?? []).find((c) => sameColumnName(c, column[1]))?.name;
  const tableEdges = drawsTableEdges(input);
  const dependencyRole = (
    parent: string,
    child: string,
    role: "table" | "group",
  ): "table" | "group" | "soft" => (soft(parent, child) ? "soft" : role);
  const tableSpecs: LayoutEdgeSpec[] = [
    ...(tableEdges ? data.edges : []).map(([parent, child]) => ({
      id: tableEdgeId(parent, child),
      from: parent,
      to: child,
      role: dependencyRole(parent, child, "table"),
    })),
    ...(tableEdges ? (input.groupEdges ?? []) : []).map(([parent, child]) => ({
      id: groupEdgeId(parent, child),
      from: parent,
      to: child,
      role: dependencyRole(parent, child, "group"),
    })),
  ].filter((edge) => both(edge.from, edge.to));
  const columnSpecs: LayoutEdgeSpec[] = data.columnEdges
    .filter((e) => known.has(e.source[0]) && known.has(e.target[0]))
    .map((e) => ({
      id: columnEdgeId(e.source, e.target),
      from: e.source[0],
      to: e.target[0],
      role: "column",
      fromRow: rowOf(e.source[0], e.source),
      toRow: rowOf(e.target[0], e.target),
    }));
  const relationshipSpecs: LayoutEdgeSpec[] = input.refs
    .filter((ref) => both(ref.from.table, ref.to.table))
    .map((ref) => ({
      id: relationshipEdgeId(ref.id),
      from: ref.from.table,
      to: ref.to.table,
      role: "relationship",
    }));
  return {
    focus: data.start ?? "",
    cards,
    edges: [...tableSpecs, ...columnSpecs, ...relationshipSpecs],
    rankPairs: rankingEdges(input).filter(
      ([parent, child]) => both(parent, child) && !soft(parent, child),
    ),
    traceOn: data.columnEdges.length > 0,
    spacing: input.spacing,
  };
}

/** The cards the layout places: each table with its listed column rows, then each open group. */
function layoutCards(
  input: LayoutInput,
  listed: (table: string) => lineage.LineageColumn[] | undefined,
  heightOf: (id: string) => number,
): LayoutCard[] {
  const { data } = input;
  const groupsOf = input.groups ?? [];
  const tagOf = new Map(
    data.tables.map((t) => [t.table, layerTagOf(t.nodeType, t.layer)] as const),
  );
  const anchorTag = (group: GroupView) => {
    const anchor = group.edge[0] === group.id ? group.edge[1] : group.edge[0];
    return tagOf.get(anchor) ?? OTHER_TAG;
  };
  const rowsOf = (table: string): LayoutRow[] | undefined => {
    const columns = listed(table);
    if (!columns) {
      return undefined;
    }
    const chips = input.chips?.filter((c) => c.table === table).length ?? 0;
    return columns.map((column, index) => ({
      id: column.name,
      offset: columnRowOffset(index, chips),
    }));
  };
  return [
    ...data.tables.map((t) => ({
      id: t.table,
      width: geometry.tableWidth,
      height: heightOf(t.table),
      tag: layerTagOf(t.nodeType, t.layer),
      rows: rowsOf(t.table),
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

/**
 * What the layout engine is asked for: the drawn graph, the card sizes and the options. The engine and the layout
 * request read this and nothing else: no selection, highlight, colour or label. A card's size is its columns and chips
 * only, so no card's size depends on what is selected: the relation line and actions row sit in a strip under the card.
 */
export interface LayoutInput {
  data: lineage.LineageData;
  columns: Record<string, lineage.LineageColumn[]>;
  columnTables: readonly string[];
  /** Closed groups of applied expansions, each drawn as one card. */
  groups?: readonly GroupView[] | undefined;
  /** The `[parent, child]` pairs joining each group to its table. */
  groupEdges?: readonly [string, string][] | undefined;
  /** The open groups to chip on their expanded tables. */
  chips?: readonly GroupChip[] | undefined;
  /** Which connections are drawn: table and group edges under `dbt` and `both`; absent means dbt dependencies. */
  connections?: lineage.Connections | undefined;
  /** The relationships to draw, already filtered for the connections and the sources. */
  refs: readonly lineage.LineageRef[];
  /** The cards whose dependency edges are soft: drawn, pulling at a low weight, and ranking nothing. */
  softened?: readonly string[] | undefined;
  /** The engine that places and routes the cards; absent means `balanced`. */
  engine?: lineage.LineageEngine | undefined;
  /** The spacing the cards are placed with; absent means the default. */
  spacing?: lineage.SpacingPreset | undefined;
}

/**
 * What the panel draws on top of the layout: how cards are titled and what the user has selected, opened, traced or
 * filtered. None of it moves a card or an edge, so the layout never reads it.
 */
export interface FlowDecoration {
  /** How cards are titled; absent means by alias. */
  title?: TitleMode | undefined;
  /** The applied expansion keys, which mark each card's expanders as open. */
  expansions: readonly string[];
  /** Expansion keys still loading. */
  pending?: readonly string[] | undefined;
  /** Neighbours each capped expansion does not draw yet, by expansion key. */
  capped?: Record<string, number> | undefined;
  /** Whether the cards' expanders open their neighbours; off in the whole project, which draws every card, so each shows only its count. */
  expandable?: boolean | undefined;
  /** The tables drawn as cards with no edge (dbt's `meta.lineage.hidden`); the start table is never among them. */
  filteredOut?: ReadonlySet<string> | undefined;
  errors: Record<string, string[]>;
  selectedTable?: string | undefined;
  selectedColumn?: [string, string] | undefined;
  /** The column trace in flight, from which its table's pending badge is drawn. */
  tracing?: { column: [string, string]; since: number } | undefined;
  /** Empty column lists explain that strict static analysis is missing. */
  columnsNeedStrict?: boolean | undefined;
  /** `lineage.layerColors`: a colour per layer tag over the theme palette. */
  layerColors?: Readonly<Record<string, string>> | undefined;
}

/** Table and group edges are drawn under `dbt` and `both`; under `declared` only relationships and column edges are. */
export const drawsTableEdges = (input: LayoutInput): boolean =>
  input.connections !== "declared";

/**
 * The `[parent, child]` pairs that rank the cards top-down. Under `declared` no table edge is drawn,
 * so the relationships rank the cards, the referenced table upstream of the declaring one.
 */
function rankingEdges(input: LayoutInput): [string, string][] {
  return drawsTableEdges(input)
    ? [...input.data.edges, ...(input.groupEdges ?? [])]
    : input.refs.map((ref) => [ref.to.table, ref.from.table]);
}
