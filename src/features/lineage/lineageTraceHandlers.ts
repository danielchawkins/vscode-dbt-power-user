import type { lineage } from "@fusion-power-user/webview-contract";
import type { Handlers } from "../../webview/messageRouter";
import type { ColumnTraceRequests } from "./columnTraceRequests";
import type { DbtLineageService } from "./dbtLineageService";
import { connectedColumnsBody } from "./lineageBodies";
import type { Respond } from "./lineageDetailHandlers";

type PanelMessage = lineage.PanelMessage;

/**
 * The handlers of a column trace. A trace's `getConnectedColumns` runs on the token of its trace; a trace the host
 * stopped answers `cancelled` with no columns.
 */
export function columnTraceHandlers(deps: {
  dbtLineageService: DbtLineageService;
  traces: ColumnTraceRequests;
  respond: Respond;
}): Pick<Handlers<PanelMessage>, "getConnectedColumns" | "cancelColumnTrace"> {
  const { dbtLineageService, traces, respond } = deps;
  return {
    getConnectedColumns: async ({ args, syncRequestId }) => {
      const { targets, upstreamExpansion, trace } = args.params;
      const token = traces.token(trace);
      const result = await dbtLineageService.getConnectedColumns(
        { targets, upstreamExpansion },
        token,
      );
      respond(
        "getConnectedColumns",
        syncRequestId,
        token.isCancellationRequested
          ? { column_lineage: [], cancelled: true }
          : connectedColumnsBody(result, targets),
      );
    },
    cancelColumnTrace: ({ trace }) => traces.cancel(trace),
  };
}
