import type { lineage } from "@fusion-power-user/webview-contract";
import { drawnGraph, type GraphState, visibleOf } from "./graph";

/** The data the renderer draws: the drawn tables, their table edges, and the column edges the settings and filters keep. */
export function lineageData(
  state: GraphState,
  show: { direct: boolean; indirect: boolean },
): lineage.LineageData {
  const { tables, edges } = drawnGraph(state);
  const { filteredOut } = visibleOf(state);
  return {
    start: state.start,
    tables,
    edges,
    columnEdges: state.columnEdges.filter(
      (e) =>
        !filteredOut.has(e.source[0]) &&
        !filteredOut.has(e.target[0]) &&
        (e.type === "indirect" ? show.indirect : show.direct),
    ),
  };
}
