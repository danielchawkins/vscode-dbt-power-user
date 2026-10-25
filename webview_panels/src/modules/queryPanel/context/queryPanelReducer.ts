import type { queryResults } from "@fusion-power-user/webview-contract";
import { typedReducer } from "@modules/app/typedReducer";
import { QueryPanelTitleTabState } from "../components/QueryPanelContents/types";
import { HINTS } from "../constants";
import type { QueryPanelStateProps, TableData } from "./types";
import { DEFAULT_VIEW_TYPE } from "./types";

type S = QueryPanelStateProps;
type HostMessage = queryResults.HostMessage;

/** A result as the panel shows it; a restored tab has no `raw_sql`. */
interface ResultsPayload {
  rows?: TableData | undefined;
  columnNames?: string[] | undefined;
  columnTypes?: (string | null)[] | undefined;
  raw_sql?: string | undefined;
  compiled_sql?: string | undefined;
  preview?: queryResults.ModelPreview | undefined;
}

export const initialState: S = {
  viewType: DEFAULT_VIEW_TYPE,
  loading: false,
  queryResults: undefined,
  queryExecutionInfo: undefined,
  queryResultsError: undefined,
  compiledCodeMarkup: undefined,
  hints: HINTS,
  hintIndex: -1,
  limit: undefined,
  queryHistory: [],
  tabState: QueryPanelTitleTabState.Preview,
  activeEditor: undefined,
  preview: undefined,
};

/** Returns a handler that sets `key` to its payload. */
const set =
  <K extends keyof S>(key: K) =>
  (state: S, value: S[K]): S => ({ ...state, [key]: value });

const clearResults = (state: S): S => ({
  ...state,
  queryResults: undefined,
  queryExecutionInfo: undefined,
  queryResultsError: undefined,
  compiledCodeMarkup: undefined,
  preview: undefined,
  loading: false,
});

const withResults = (state: S, result: ResultsPayload): S => ({
  ...state,
  loading: false,
  queryResults: {
    data: result.rows,
    columnNames: result.columnNames,
    columnTypes: result.columnTypes,
    raw_sql: result.raw_sql,
  } as S["queryResults"],
  preview: result.preview,
  compiledCodeMarkup: result.compiled_sql,
});

/** The panel's state after one message from the host; the timers are the listener's concern. */
const applyHostMessage = (state: S, message: HostMessage): S => {
  switch (message.command) {
    case "renderError":
      return {
        ...state,
        loading: false,
        queryResultsError: message.error as S["queryResultsError"],
        preview: message.preview,
        compiledCodeMarkup: message.compiled_sql,
      };
    case "renderQuery":
      return withResults(state, message);
    case "resetState":
      return clearResults(state);
    case "renderLoading":
      return state.loading ? state : { ...clearResults(state), loading: true };
    case "queryHistory":
      return { ...state, queryHistory: message.args.body };
    case "updateViewType":
      return { ...state, viewType: message.args.body.type };
    case "getContext":
      return {
        ...state,
        limit: message.limit,
        publication: message.publication,
        activeEditor: message.activeEditor as S["activeEditor"],
      };
    // The app listener settles responses.
    case "response":
      return state;
  }
};

const queryPanel = typedReducer<
  S,
  {
    resetData: undefined;
    setHints: S["hints"];
    setHintIndex: S["hintIndex"];
    setTabState: S["tabState"];
    setLimit: S["limit"];
    setQueryExecutionInfo: S["queryExecutionInfo"];
    setLoading: S["loading"];
    hostMessage: HostMessage;
    restoreResults: ResultsPayload;
  }
>({
  resetData: clearResults,
  setHints: set("hints"),
  setHintIndex: set("hintIndex"),
  setTabState: set("tabState"),
  setLimit: set("limit"),
  setQueryExecutionInfo: set("queryExecutionInfo"),
  setLoading: set("loading"),
  hostMessage: applyHostMessage,
  restoreResults: withResults,
});

export const queryPanelReducer = queryPanel.reducer;
export type QueryPanelAction = Parameters<typeof queryPanelReducer>[1];

const { resetData: resetDataAction, ...setters } = queryPanel.actions;
export const resetData = (): QueryPanelAction => resetDataAction(undefined);
export const {
  setHints,
  setLoading,
  setHintIndex,
  setQueryExecutionInfo,
  setLimit,
  setTabState,
  hostMessage,
  restoreResults,
} = setters;
