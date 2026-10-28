import { useCallback, useEffect, useRef } from "react";
import { useQueryPanelDispatch } from "./context/queryPanelContext";
import { setQueryExecutionInfo } from "./context/queryPanelReducer";

/**
 * Times a query run for the panel's elapsed time: `start` ticks it while the run is open, and
 * `stop(true)` ends it with a final time, which an early result has not had; `stop(false)` ends it
 * without one, as a reset does. Unmounting stops it.
 */
const useLoadingClock = (): {
  start: () => void;
  stop: (record: boolean) => void;
} => {
  const dispatch = useQueryPanelDispatch();
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const startRef = useRef(0);

  useEffect(
    () => () => {
      globalThis.clearInterval(timerRef.current);
      timerRef.current = undefined;
    },
    [],
  );

  const start = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = globalThis.setInterval(() => {
      const elapsedTime =
        Math.round((Date.now() - startRef.current) / 100) / 10;
      const time = isNaN(elapsedTime) ? 0 : elapsedTime;
      dispatch(setQueryExecutionInfo({ elapsedTime: time }));
    }, 100);
  }, [dispatch]);

  const stop = useCallback(
    (record: boolean) => {
      if (timerRef.current === undefined) {
        return;
      }
      globalThis.clearInterval(timerRef.current);
      timerRef.current = undefined;
      if (record) {
        const elapsedTime =
          Math.round((Date.now() - startRef.current) / 100) / 10;
        dispatch(setQueryExecutionInfo({ elapsedTime }));
      }
    },
    [dispatch],
  );

  return { start, stop };
};

export default useLoadingClock;
