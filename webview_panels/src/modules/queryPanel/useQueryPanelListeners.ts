import type { queryResults } from "@fusion-power-user/webview-contract";
import type { MessageOf } from "@modules/app/requestExecutor";
import { panelLogger } from "@modules/logger";
import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/queryPanel/requests";
import { useCallback, useEffect, useRef } from "react";
import { HINTS } from "./constants";
import { useQueryPanelDispatch } from "./context/queryPanelContext";
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
  const hintIntervalRef = useRef<number | undefined>(undefined);
  const hintIndexRef = useRef<number>(hintIndex);
  const queryExecutionTimerRef = useRef<number | undefined>(undefined);
  const queryStartRef = useRef(0);

  useEffect(() => {
    hintIndexRef.current = hintIndex;
  }, [hintIndex]);

  const handleHintMessage = useCallback(() => {
    dispatch(setHintIndex(-1));
    HINTS.sort(() => Math.random() - 0.5);
    dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));

    hintIntervalRef.current = window.setInterval(() => {
      dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));
    }, 3500);
  }, [dispatch]);

  const clearData = useCallback(() => {
    dispatch(resetData());
    queryStartRef.current = Date.now();
  }, [dispatch]);

  const endQueryExecutionTimer = useCallback(
    () => window.clearInterval(queryExecutionTimerRef.current),
    [],
  );

  const handleLoading = useCallback(() => {
    if (loading) {
      return;
    }
    clearData();
    dispatch(setLoading(true));
    queryExecutionTimerRef.current = window.setInterval(() => {
      const now = Date.now();
      const elapsedTime = Math.round((now - queryStartRef.current) / 100) / 10;
      const time = isNaN(elapsedTime) ? 0 : elapsedTime;
      dispatch(setQueryExecutionInfo({ elapsedTime: time }));
    }, 100);
    handleHintMessage();
  }, [loading, dispatch, clearData, handleHintMessage]);

  const clearHintInterval = useCallback(() => {
    window.clearInterval(hintIntervalRef.current);
    hintIntervalRef.current = undefined;
  }, []);

  const handleError = useCallback(
    (message: MessageOf<HostMessage, "renderError">) => {
      dispatch(
        setQueryResultsError(
          message.error as QueryPanelStateProps["queryResultsError"],
        ),
      );
      dispatch(setCompiledCodeMarkup(message.compiled_sql));
      clearHintInterval();
      endQueryExecutionTimer();
    },
    [dispatch, clearHintInterval, endQueryExecutionTimer],
  );

  const handleQueryResults = useCallback(
    (result: {
      rows?: TableData | undefined;
      columnNames?: string[] | undefined;
      columnTypes?: (string | null)[] | undefined;
      raw_sql?: string | undefined;
      compiled_sql?: string | undefined;
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
    },
    [dispatch, clearHintInterval, endQueryExecutionTimer],
  );

  const handleResetState = useCallback(() => {
    clearData();
    clearHintInterval();
    endQueryExecutionTimer();
  }, [clearData, clearHintInterval, endQueryExecutionTimer]);

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
        // The app listener settles responses.
        case "response":
          break;
      }
    },
    [
      handleLoading,
      handleError,
      handleResetState,
      handleQueryResults,
      dispatch,
    ],
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
  }, [dispatch, handleQueryResults]);

  return { loading };
};

export default useQueryPanelListeners;
