import { typedReducer } from "@modules/app/typedReducer";
import { QueryPanelTitleTabState } from "../components/QueryPanelContents/types";
import { QueryPanelStateProps, DEFAULT_VIEW_TYPE } from "./types";

type S = QueryPanelStateProps;

export const initialState: S = {
  viewType: DEFAULT_VIEW_TYPE,
  loading: false,
  queryResults: undefined,
  queryExecutionInfo: undefined,
  queryResultsError: undefined,
  compiledCodeMarkup: undefined,
  hintIndex: -1,
  limit: undefined,
  perspectiveTheme: "Vintage",
  queryHistory: [],
  tabState: QueryPanelTitleTabState.Preview,
  activeEditor: undefined,
};

/** Returns a handler that sets `key` to its payload. */
const set =
  <K extends keyof S>(key: K) =>
  (state: S, value: S[K]): S => ({ ...state, [key]: value });

const queryPanel = typedReducer<
  S,
  {
    setActiveEditor: S["activeEditor"];
    resetData: undefined;
    setViewType: S["viewType"];
    setHintIndex: S["hintIndex"];
    setTabState: S["tabState"];
    setQueryHistory: S["queryHistory"];
    setPerspectiveTheme: S["perspectiveTheme"] | undefined;
    setCompiledCodeMarkup: S["compiledCodeMarkup"];
    setLimit: S["limit"];
    setQueryResultsError: S["queryResultsError"];
    setQueryExecutionInfo: S["queryExecutionInfo"];
    setQueryResults: S["queryResults"];
    setLoading: S["loading"];
    setPublication: S["publication"];
  }
>({
  setActiveEditor: set("activeEditor"),
  resetData: (state) => ({
    ...state,
    queryResults: undefined,
    queryExecutionInfo: undefined,
    queryResultsError: undefined,
    compiledCodeMarkup: undefined,
    loading: false,
  }),
  setViewType: set("viewType"),
  setHintIndex: set("hintIndex"),
  setTabState: set("tabState"),
  setQueryHistory: set("queryHistory"),
  setPerspectiveTheme: (state, theme) => ({
    ...state,
    perspectiveTheme: theme === undefined || theme === "" ? "Vintage" : theme,
  }),
  setCompiledCodeMarkup: set("compiledCodeMarkup"),
  setLimit: set("limit"),
  setQueryResultsError: (state, queryResultsError) => ({
    ...state,
    loading: false,
    queryResultsError,
  }),
  setQueryExecutionInfo: set("queryExecutionInfo"),
  setQueryResults: set("queryResults"),
  setLoading: set("loading"),
  setPublication: set("publication"),
});

export const queryPanelReducer = queryPanel.reducer;
export type QueryPanelAction = Parameters<typeof queryPanelReducer>[1];

const { resetData: resetDataAction, ...setters } = queryPanel.actions;
export const resetData = (): QueryPanelAction => resetDataAction(undefined);
export const {
  setViewType,
  setLoading,
  setHintIndex,
  setCompiledCodeMarkup,
  setQueryResultsError,
  setQueryExecutionInfo,
  setQueryResults,
  setLimit,
  setPerspectiveTheme,
  setQueryHistory,
  setTabState,
  setActiveEditor,
  setPublication,
} = setters;
