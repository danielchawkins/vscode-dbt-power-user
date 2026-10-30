import type { lineage } from "@fusion-power-user/webview-contract";
import { drawnGraph, type GraphState, visibleOf } from "./graph";

/** The data the renderer draws: the drawn tables, their table edges, and the column edges between drawn cards that the settings and filters keep. */
export function lineageData(
  state: GraphState,
  show: { direct: boolean; indirect: boolean },
): lineage.LineageData {
  const { tables, edges } = drawnGraph(state);
  const visible = visibleOf(state);
  return {
    start: state.start,
    tables,
    edges,
    columnEdges: state.columnEdges.filter(
      (e) =>
        visible.hasEdges(e.source[0]) &&
        visible.hasEdges(e.target[0]) &&
        (e.type === "indirect" ? show.indirect : show.direct),
    ),
  };
}
