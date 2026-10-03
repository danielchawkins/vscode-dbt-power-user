import { describe, expect, it } from "vitest";
import { getVsCodeApiMock } from "../../test/setup";
import {
  isViewState,
  MAX_VIEW_STATE_STRING,
  PanelViewState,
  readViewState,
  VIEW_STATE_FIELDS,
  writeViewState,
} from "./viewState";

/** Keys no panel may persist: payloads, SQL, credentials, query ids and warehouse metadata. */
const FORBIDDEN_KEYS = [
  "rows",
  "data",
  "queryResults",
  "columnNames",
  "columnTypes",
  "sql",
  "raw_sql",
  "compiled_sql",
  "compiledCodeMarkup",
  "query",
  "queryId",
  "queryHistory",
  "password",
  "token",
  "credentials",
  "profile",
  "docs",
  "tests",
  "columns",
  "node",
];

const samples: PanelViewState[] = [
  {
    panel: "documentationEditor",
    publication: "s:3",
    model: "model.p.orders",
    scrollTop: 120,
    searchQuery: "id",
  },
  { panel: "queryResults", publication: "s:3", tabState: 1 },
];

describe("panel view state", () => {
  it("allowlists only view-state keys for every panel", () => {
    for (const fields of Object.values(VIEW_STATE_FIELDS)) {
      for (const key of Object.keys(fields)) {
        expect(FORBIDDEN_KEYS).not.toContain(key);
      }
    }
  });

  it("writes each panel's view state through vscode.setState", () => {
    for (const state of samples) {
      expect(writeViewState(state)).toBe(true);
      expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith(state);
    }
  });

  it.each(FORBIDDEN_KEYS)("refuses to write a %s field", (key) => {
    for (const state of samples) {
      getVsCodeApiMock().setState.mockClear();
      const leaked = { ...state, [key]: "select * from secrets" };
      expect(writeViewState(leaked as PanelViewState)).toBe(false);
      expect(getVsCodeApiMock().setState).not.toHaveBeenCalled();
    }
  });

  it("refuses a string longer than a filter", () => {
    expect(
      isViewState("documentationEditor", {
        ...samples[0],
        searchQuery: "x".repeat(MAX_VIEW_STATE_STRING + 1),
      }),
    ).toBe(false);
  });

  it("refuses a field of the wrong kind or another panel's state", () => {
    expect(
      isViewState("queryResults", { panel: "queryResults", tabState: "1" }),
    ).toBe(false);
    expect(isViewState("documentationEditor", samples[1])).toBe(false);
  });

  it("reads back only a valid state for the asking panel", () => {
    getVsCodeApiMock().getState.mockReturnValueOnce(samples[1] as never);
    expect(readViewState("queryResults")).toEqual(samples[1]);
    getVsCodeApiMock().getState.mockReturnValueOnce({
      ...samples[1],
      rows: [],
    } as never);
    expect(readViewState("queryResults")).toBeUndefined();
  });
});
