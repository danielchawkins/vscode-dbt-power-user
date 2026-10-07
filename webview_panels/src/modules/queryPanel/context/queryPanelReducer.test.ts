import { describe, expect, it } from "vitest";
import {
  initialState,
  queryPanelReducer,
  resetData,
  setLimit,
  setLoading,
  setQueryResults,
  setQueryResultsError,
} from "./queryPanelReducer";

const results = {
  data: [{ id: 1 }],
  columnNames: ["id"],
  columnTypes: ["integer"],
  raw_sql: "select 1",
  compiled_sql: "select 1",
};

describe("queryPanelReducer", () => {
  it("clears results, errors and loading on reset and keeps view choices", () => {
    const loaded = [
      setLoading(true),
      setQueryResults(results),
      setQueryResultsError({ message: "m", code: 1, data: "d" }),
      setLimit(50),
    ].reduce(queryPanelReducer, initialState);

    const reset = queryPanelReducer(loaded, resetData());

    expect(reset.queryResults).toBeUndefined();
    expect(reset.queryResultsError).toBeUndefined();
    expect(reset.loading).toBe(false);
    expect(reset.limit).toBe(50);
  });

  it("stops loading when an error arrives", () => {
    const state = queryPanelReducer(
      queryPanelReducer(initialState, setLoading(true)),
      setQueryResultsError({ message: "m", code: 1, data: "d" }),
    );
    expect(state.loading).toBe(false);
    expect(state.queryResultsError?.message).toBe("m");
  });
});
