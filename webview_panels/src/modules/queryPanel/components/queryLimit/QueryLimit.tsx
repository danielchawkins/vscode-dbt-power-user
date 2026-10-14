import { PlayIcon } from "@assets/icons";
import { useQueryPanelDispatch } from "@modules/queryPanel/context/queryPanelContext";
import { setLimit } from "@modules/queryPanel/context/queryPanelReducer";
import { executeRequestInAsync } from "@modules/queryPanel/requests";
import useQueryPanelState from "@modules/queryPanel/useQueryPanelState";
import { Input, Stack } from "@uicore";
import { useState } from "react";
import styles from "./styles.module.css";

enum LimitSaveState {
  Default = 1,
  Dirty,
  Saved,
}

function saveStateOf(
  value: string,
  saved: string,
  justSaved: boolean,
): LimitSaveState {
  if (value && value !== saved) {
    return LimitSaveState.Dirty;
  }
  return justSaved ? LimitSaveState.Saved : LimitSaveState.Default;
}

const QueryLimit = (): React.JSX.Element => {
  const { limit, activeEditor } = useQueryPanelState();
  const limitStr = limit?.toString() ?? "500";
  const resetKey = `${limitStr}|${activeEditor?.filepath ?? ""}`;
  const [value, setValue] = useState(limitStr);
  const [valueKey, setValueKey] = useState(resetKey);
  const [saved, setSaved] = useState(false);
  if (valueKey !== resetKey) {
    setValueKey(resetKey);
    setValue(limitStr);
  }
  const limitSaveState = saveStateOf(value, limitStr, saved);
  const [isFocused, setIsFocused] = useState(false);
  const dispatch = useQueryPanelDispatch();
  const saveLimit = () => {
    if (!value) {
      return;
    }
    dispatch(setLimit(parseInt(value)));
    executeRequestInAsync("updateConfig", { limit: parseInt(value) });
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
    }, 2000);
  };

  return (
    <div className={styles.container}>
      <Stack className={styles.limitContainer}>
        <label className={styles.label} htmlFor="query-limit">
          Limit
        </label>
        <div
          className={[
            styles.content,
            isFocused ? styles.active : styles.inactive,
          ].join(" ")}
        >
          <Input
            id="query-limit"
            type="number"
            value={value}
            onChange={(e) => {
              const newValue = e.target.value.replaceAll(/[^\d]/g, "");
              setValue(newValue);
            }}
            className={styles.input}
            onFocus={() => {
              setIsFocused(true);
            }}
            onBlur={() => {
              setIsFocused(false);
            }}
          />

          <button
            type="button"
            aria-label="Run query"
            className={[
              styles.playButton,
              value && activeEditor?.filepath?.endsWith(".sql")
                ? styles.active
                : styles.inactive,
            ].join(" ")}
            onClick={() => {
              if (value && activeEditor?.filepath?.endsWith(".sql")) {
                executeRequestInAsync("executeQueryFromActiveWindow", {
                  limit: parseInt(value),
                });
              }
            }}
          >
            <PlayIcon />
          </button>
        </div>
      </Stack>
      {limitSaveState !== LimitSaveState.Default && (
        <Stack className={styles.saveContainer}>
          <div>Set as default</div>
          {limitSaveState === LimitSaveState.Dirty ? (
            <button
              type="button"
              className={styles.saveButton}
              onClick={saveLimit}
            >
              Save
            </button>
          ) : (
            <div className={styles.saveButton}>Saved</div>
          )}
        </Stack>
      )}
    </div>
  );
};

export default QueryLimit;
