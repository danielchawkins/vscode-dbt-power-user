import type { queryResults } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { QUERY_RESULTS_REPLAY } from "../../features/queryResults/replayRules";
import { PanelReplay as Replay } from "../../webview/panelHost";

class PanelReplay<K> extends Replay<K, queryResults.HostMessage> {
  constructor() {
    super(QUERY_RESULTS_REPLAY);
  }
}

const result = {
  command: "renderQuery" as const,
  columnNames: ["n"],
  columnTypes: ["integer"],
  rows: [{ n: 1 }],
  raw_sql: "select 1",
  compiled_sql: "select 1",
};
const viewType = {
  command: "updateViewType" as const,
  args: { body: { type: 0 as const } },
};

describe("query results replay", () => {
  it("replays the last view type and result to a rebuilt page", () => {
    const replay = new PanelReplay<string>();
    replay.record("bottom", viewType);
    replay.record("bottom", { command: "renderLoading" });
    replay.record("bottom", result);
    replay.record("bottom", {
      command: "getContext",
      limit: 1,
      activeEditor: {},
    });

    expect(replay.messagesFor("bottom")).toEqual([viewType, result]);
  });

  it("drops the result once loading or a reset follows it", () => {
    const replay = new PanelReplay<string>();
    replay.record("bottom", result);
    replay.record("bottom", { command: "resetState" });
    expect(replay.messagesFor("bottom")).toEqual([]);
  });

  it("keeps each page's result and tab data apart and forgets closed pages", () => {
    const replay = new PanelReplay<string>();
    replay.record("tab", result);
    replay.setTabData("tab", { queryResults: {} });

    expect(replay.messagesFor("bottom")).toEqual([]);
    expect(replay.tabDataFor("tab")).toEqual({ queryResults: {} });

    replay.delete("tab");
    expect(replay.messagesFor("tab")).toEqual([]);
    expect(replay.tabDataFor("tab")).toBeUndefined();
  });
});
