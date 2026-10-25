import type { queryResults } from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/queryPanel/requests";
import { useCallback, useEffect, useRef } from "react";
import { HINTS } from "./constants";
import { useQueryPanelDispatch } from "./context/queryPanelContext";
import {
  hostMessage,
  restoreResults,
  setHintIndex,
  setHints,
  setQueryExecutionInfo,
} from "./context/queryPanelReducer";
import useLoadingClock from "./useLoadingClock";
import useQueryPanelState from "./useQueryPanelState";

type HostMessage = queryResults.HostMessage;

const useQueryPanelListeners = (): { loading: boolean } => {
  const dispatch = useQueryPanelDispatch();
  const { loading, hintIndex } = useQueryPanelState();
  const { start: startClock, stop: stopClock } = useLoadingClock();
  const hintIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const hintIndexRef = useRef<number>(hintIndex);

  useEffect(() => {
    hintIndexRef.current = hintIndex;
  }, [hintIndex]);

  const handleHintMessage = useCallback(() => {
    dispatch(setHintIndex(-1));
    dispatch(setHints(HINTS.toSorted(() => Math.random() - 0.5)));
    dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));

    hintIntervalRef.current = globalThis.setInterval(() => {
      dispatch(setHintIndex((hintIndexRef.current + 1) % HINTS.length));
    }, 3500);
  }, [dispatch]);

  const clearHintInterval = useCallback(() => {
    globalThis.clearInterval(hintIntervalRef.current);
    hintIntervalRef.current = undefined;
  }, []);

  /** A result or an error ends the run: its hints stop, and its clock records the final time. */
  const endRun = useCallback(() => {
    clearHintInterval();
    stopClock(true);
  }, [clearHintInterval, stopClock]);

  const onMessage = useCallback(
    (event: MessageEvent<HostMessage>) => {
      panelLogger.info("query panel onMessage", event.data);
      const message = event.data;
      switch (message.command) {
        case "renderLoading":
          if (!loading) {
            dispatch(hostMessage(message));
            startClock();
            handleHintMessage();
          }
          break;
        case "renderError":
        case "renderQuery":
          dispatch(hostMessage(message));
          endRun();
          break;
        case "resetState":
          dispatch(hostMessage(message));
          clearHintInterval();
          stopClock(false);
          break;
        case "queryHistory":
        case "updateViewType":
        case "getContext":
        case "response":
          dispatch(hostMessage(message));
          break;
      }
    },
    [
      loading,
      dispatch,
      startClock,
      stopClock,
      handleHintMessage,
      endRun,
      clearHintInterval,
    ],
  );

  useEffect(() => {
    executeRequestInAsync("getQueryPanelContext");
  }, []);

  useEffect(() => {
    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [onMessage]);

  useEffect(() => {
    void executeRequestInSync("getQueryTabData").then((data) => {
      if (data) {
        dispatch(
          restoreResults({
            rows: data.queryResults?.data,
            columnNames: data.queryResults?.columnNames,
            columnTypes: data.queryResults?.columnTypes,
            compiled_sql: data.compiledCodeMarkup,
            preview: data.preview,
          }),
        );
        endRun();
        dispatch(setQueryExecutionInfo(data.queryExecutionInfo));
      }
    });
  }, [dispatch, endRun]);

  return { loading };
};

export default useQueryPanelListeners;
