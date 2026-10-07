import type { queryResults } from "@fusion-power-user/webview-contract";
import type { ReplayRules } from "../../webview/panelHost";

/** A rebuilt query results page gets back its last view type and result. */
export const QUERY_RESULTS_REPLAY: ReplayRules<queryResults.HostMessage> = {
  order: ["viewType", "result"],
  slotOf: {
    updateViewType: "viewType",
    renderQuery: "result",
    renderError: "result",
  },
  clears: ["renderLoading", "resetState"],
  clearSlot: "result",
};
