import type { lineage } from "@fusion-power-user/webview-contract";
import { type EdgeGroup, edgeGroupsOf, withoutEdgeGroups } from "./edgeGroups";
import type { Layouter } from "./engine/layoutCache";
import type { LayoutInput } from "./engine/layoutRequest";
import { cappedCounts } from "./expansionCap";
import { collapsedGroups, groupChips } from "./expansionGroups";
import { type BuiltFlow, drawnPairs, toFlow } from "./flow";
import type { GraphState } from "./graph";
import { visibleOf } from "./graph";
import { combinedEdges } from "./groupEdges";
import { hintEdges, withoutTransitiveEdges } from "./transitiveReduction";
import type { ResolvedSettings } from "./viewModel";
import { visibleRefs } from "./viewModel";
import { lineageData } from "./visibility";

/**
 * The React Flow nodes and edges of the drawn graph, with no emphasis, and the drawn pairs the emphasis follows. The
 * layout input drops the edges of the edge groups the Scope switched off, and then the dependencies transitive reduction
 * removes; the removed ones are drawn as hints, which no layout sees.
 */
/**
 * The settings a flow is built from: each one that places, labels or filters a card or edge. The emphasis settings are
 * not among them, so changing one restyles the built flow instead of rebuilding it.
 */
export type FlowSettings = Pick<
  ResolvedSettings,
  | "showSelectEdges"
  | "showNonSelectEdges"
  | "connections"
  | "engine"
  | "title"
  | "layerColors"
  | "enabledRefSources"
  | "inferenceConfidenceThreshold"
>;

/** The counts of `extra` added to those of `base`, key by key. */
const sumCounts = (
  base: Record<string, number>,
  extra: Record<string, number>,
): Record<string, number> => {
  const sum = { ...base };
  for (const [key, count] of Object.entries(extra)) {
    sum[key] = (sum[key] ?? 0) + count;
  }
  return sum;
};

export const flowOf = ({
  graph,
  settings,
  refs,
  columnsNeedStrict,
  layouter,
}: {
  graph: GraphState;
  settings: FlowSettings;
  refs: lineage.LineageRef[];
  columnsNeedStrict: boolean;
  layouter: Layouter;
}): {
  flow: BuiltFlow;
  pairs: ReturnType<typeof drawnPairs>;
  edgeGroups: EdgeGroup[];
} => {
  const visible = visibleOf(graph);
  const data = lineageData(graph, {
    direct: settings.showSelectEdges,
    indirect: settings.showNonSelectEdges,
  });
  const drawn = new Set(data.tables.map((t) => t.table));
  const groups = collapsedGroups(graph);
  const layout: LayoutInput = {
    data,
    columns: graph.columns,
    columnTables: graph.columnTables,
    groups,
    groupEdges: combinedEdges(graph, groups),
    chips: groupChips(graph),
    connections: settings.connections,
    refs: visibleRefs(refs, settings, drawn),
    engine: settings.engine,
    softened: graph.scope.softened,
  };
  // The edge groups are listed from the whole input, so a group switched off stays in the Scope control.
  const edgeGroups = edgeGroupsOf(layout);
  const kept = withoutEdgeGroups(layout, graph.scope.offEdgeGroups);
  // Transitive reduction runs last, on the edges the filters, exclusions and edge groups left.
  const reduced = withoutTransitiveEdges(kept, graph.scope.transitiveReduction);
  const placed = toFlow(
    reduced.layout,
    {
      title: settings.title,
      expansions: graph.expansions,
      pending: graph.pending,
      capped: sumCounts(cappedCounts(graph), visible.capped),
      // The whole project draws every card, so an expander has no neighbours to open.
      expandable: graph.view.viewMode === "neighbourhood",
      filteredOut: visible.filteredOut,
      errors: graph.errors,
      selectedTable: graph.selectedTable,
      selectedColumn: graph.selectedColumn,
      tracing: graph.tracing,
      columnsNeedStrict,
      layerColors: settings.layerColors,
    },
    layouter,
  );
  // The dropped edges are drawn as hints between their cards, after the routed edges, which no layout sees.
  const flow = {
    ...placed,
    edges: [
      ...placed.edges,
      ...hintEdges(
        reduced.dropped,
        new Set(placed.nodes.map((node) => node.id)),
      ),
    ],
  };
  return {
    flow,
    pairs: [...drawnPairs(reduced.layout), ...reduced.dropped],
    edgeGroups,
  };
};
