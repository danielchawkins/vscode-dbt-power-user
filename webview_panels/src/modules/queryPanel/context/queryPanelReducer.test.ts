import { describe, expect, it } from "vitest";
import {
  hostMessage,
  initialState,
  queryPanelReducer,
  resetData,
  setLimit,
  setLoading,
} from "./queryPanelReducer";

/** What the host posts for a result and for an error; the panel applies both through `hostMessage`. */
const result = hostMessage({
  command: "renderQuery",
  rows: [{ id: 1 }],
  columnNames: ["id"],
  columnTypes: ["integer"],
  raw_sql: "select 1",
  compiled_sql: "select 1",
});
const error = hostMessage({
  command: "renderError",
  error: { message: "m", code: 1, data: "d" },
  raw_sql: "select 1",
  compiled_sql: "select 1",
});

describe("queryPanelReducer", () => {
  it("clears results, errors and loading on reset and keeps view choices", () => {
    const loaded = [setLoading(true), result, error, setLimit(50)].reduce(
      queryPanelReducer,
      initialState,
    );

    const reset = queryPanelReducer(loaded, resetData());

    expect(reset.queryResults).toBeUndefined();
    expect(reset.queryResultsError).toBeUndefined();
    expect(reset.loading).toBe(false);
    expect(reset.limit).toBe(50);
  });

  it("stops loading when an error arrives", () => {
    const state = queryPanelReducer(
      queryPanelReducer(initialState, setLoading(true)),
      error,
    );
    expect(state.loading).toBe(false);
    expect(state.queryResultsError?.message).toBe("m");
  });
});
