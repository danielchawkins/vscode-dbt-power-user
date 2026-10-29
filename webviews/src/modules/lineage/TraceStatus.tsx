import { Tooltip } from "@uicore";
import { use, useEffect, useState } from "react";
import styles from "./lineageGraph.module.css";
import { TableActionsContext } from "./viewModel";

/** The warning flag of a table whose trace failed; its tooltip lists the errors and offers Retry. */
export const ErrorFlag = ({
  errors,
}: {
  errors: string[];
}): React.JSX.Element => {
  const actions = use(TableActionsContext);
  return (
    <Tooltip
      title={
        <>
          {errors.map((line) => (
            <div key={line}>{line}</div>
          ))}
          <button type="button" className="nodrag" onClick={actions.retryTrace}>
            Retry
          </button>
        </>
      }
    >
      <button
        type="button"
        className={`nodrag codicon codicon-warning ${styles.error}`}
        aria-label={errors.join("\n")}
      />
    </Tooltip>
  );
};

/** Whole seconds since `since`, read on a one-second tick while the component is mounted. */
const useElapsedSeconds = (since: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
};

/** The pending line under the traced column, with a Cancel button that stops its trace. */
export const TraceStatus = ({
  since,
}: {
  since: number;
}): React.JSX.Element => {
  const actions = use(TableActionsContext);
  const seconds = useElapsedSeconds(since);
  return (
    <output className={styles.tracing}>
      {`Tracing column lineage… ${seconds}s`}
      <button type="button" className="nodrag" onClick={actions.cancelTrace}>
        Cancel
      </button>
    </output>
  );
};
