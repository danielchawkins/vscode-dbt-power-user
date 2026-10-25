import type { queryResults } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { tabDataOf } from "../../features/queryResults/queryPanelSupport";

const entry: queryResults.QueryHistoryEntry = {
  rawSql: "select * from orders",
  compiledSql: "select * from analytics.orders",
  timestamp: 1_728_000_000_000,
  duration: 2.5,
  adapter: "snowflake",
  projectName: "demo",
  data: [{ id: 1 }],
  columnNames: ["id"],
  columnTypes: ["NUMBER"],
  modelName: "orders",
};

describe("tabDataOf", () => {
  it("sends the elapsed time at queryExecutionInfo.elapsedTime, where the results tab reads it", () => {
    expect(tabDataOf(entry)).toEqual({
      queryResults: {
        data: [{ id: 1 }],
        columnNames: ["id"],
        columnTypes: ["NUMBER"],
      },
      compiledCodeMarkup: "select * from analytics.orders",
      rawSql: "select * from orders",
      queryExecutionInfo: { elapsedTime: 2.5 },
    });
  });
});
