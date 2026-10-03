import type { queryResults } from "@fusion-power-user/webview-contract";
import type { MessageOf } from "@modules/app/requestExecutor";
import { panelLogger } from "@modules/logger";
import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/queryPanel/requests";
import { useCallback, useEffect, useRef } from "react";
import { useQueryPanelDispatch } from "./QueryPanelProvider";
import { HINTS } from "./constants";
import {
  resetData,
  setActiveEditor,
  setCompiledCodeMarkup,
  setHintIndex,
  setLimit,
  setLoading,
  setPerspectiveTheme,
  setPublication,
  setQueryExecutionInfo,
  setQueryHistory,
  setQueryResults,
  setQueryResultsError,
  setViewType,
} from "./context/queryPanelReducer";
import { QueryPanelStateProps, TableData } from "./context/types";
import useQueryPanelState from "./useQueryPanelState";

type HostMessage = queryResults.HostMessage;

const useQueryPanelListeners = (): { loading: boolean } => {
  const dispatch = useQueryPanelDispatch();
  const { loading, hintIndex } = useQueryPanelState();
  const hintInterval = useRef<number | undefined>(undefined);
  const hintIndexRef = useRef<number>(hintIndex);
  const queryExecutionTimer = useRef<number | undefined>(undefined);
  const queryStart = useRef(Date.now());

  useEffect(() => {
    hintIndexRef.current = hintIndex;
  }, [hintIndex]);

  const handleHintMessage = useCallback(() => {
    dispatch(setHintIndex(-1));
    HINTS.sort(() => Math.random() - 0.5);
    dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));

    hintInterval.current = window.setInterval(() => {
      dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));
    }, 3500);
  }, [dispatch, hintIndex]);

  const clearData = () => {
    dispatch(resetData());
    queryStart.current = Date.now();
  };

  const endQueryExecutionTimer = () =>
    window.clearInterval(queryExecutionTimer.current);

  const handleLoading = useCallback(() => {
    if (loading) {
      return;
    }
    clearData();
    dispatch(setLoading(true));
    queryExecutionTimer.current = window.setInterval(() => {
      const now = Date.now();
      const elapsedTime = Math.round((now - queryStart.current) / 100) / 10;
      const time = isNaN(elapsedTime) ? 0 : elapsedTime;
      dispatch(setQueryExecutionInfo({ elapsedTime: time }));
    }, 100);
    handleHintMessage();
  }, [loading, dispatch, handleHintMessage]);

  const clearHintInterval = () => {
    window.clearInterval(hintInterval.current);
    hintInterval.current = undefined;
  };

  const handleError = (message: MessageOf<HostMessage, "renderError">) => {
    dispatch(
      setQueryResultsError(
        message.error as QueryPanelStateProps["queryResultsError"],
      ),
    );
    dispatch(setCompiledCodeMarkup(message.compiled_sql));
    clearHintInterval();
    endQueryExecutionTimer();
  };

  const handleQueryResults = (result: {
    rows?: TableData;
    columnNames?: string[];
    columnTypes?: (string | null)[];
    raw_sql?: string;
    compiled_sql?: string;
  }) => {
    dispatch(setLoading(false));
    dispatch(
      setQueryResults({
        data: result.rows,
        columnNames: result.columnNames,
        columnTypes: result.columnTypes,
        raw_sql: result.raw_sql,
      } as QueryPanelStateProps["queryResults"]),
    );
    dispatch(setCompiledCodeMarkup(result.compiled_sql));
    clearHintInterval();
    endQueryExecutionTimer();
  };

  const handleResetState = () => {
    clearData();
    clearHintInterval();
    endQueryExecutionTimer();
  };

  const onMesssage = useCallback(
    (event: MessageEvent<HostMessage>) => {
      panelLogger.info("query panel onMesssage", event.data);
      const message = event.data;
      switch (message.command) {
        case "renderError":
          handleError(message);
          break;
        case "resetState":
          handleResetState();
          break;
        case "renderQuery":
          handleQueryResults(message);
          break;
        case "renderLoading":
          handleLoading();
          break;
        case "queryHistory":
          dispatch(setQueryHistory(message.args.body));
          break;
        case "updateViewType":
          dispatch(setViewType(message.args.body.type));
          break;
        case "getContext":
          dispatch(setLimit(message.limit));
          dispatch(setPerspectiveTheme(message.perspectiveTheme));
          dispatch(setPublication(message.publication));
          dispatch(
            setActiveEditor(
              message.activeEditor as QueryPanelStateProps["activeEditor"],
            ),
          );
          break;
        default:
          break;
      }
    },
    [handleLoading, dispatch],
  );

  useEffect(() => {
    executeRequestInAsync("getQueryPanelContext");
  }, []);

  useEffect(() => {
    window.addEventListener("message", onMesssage);

    return () => {
      window.removeEventListener("message", onMesssage);
    };
  }, [onMesssage]);

  useEffect(() => {
    void executeRequestInSync("getQueryTabData").then((data) => {
      if (data) {
        const typedData = data as QueryPanelStateProps;
        handleQueryResults({
          rows: typedData?.queryResults?.data,
          columnNames: typedData?.queryResults?.columnNames,
          columnTypes: typedData?.queryResults?.columnTypes,
          compiled_sql: typedData.compiledCodeMarkup,
        });
        dispatch(
          setQueryExecutionInfo({
            elapsedTime: typedData.queryExecutionInfo!.elapsedTime,
          }),
        );
      }
    });
  }, []);

  return { loading };
};

export default useQueryPanelListeners;
