import { useState } from "react";
import { SaveRequest } from "../types";

export type SetTestFormValue = <K extends keyof SaveRequest>(
  name: K,
  value: SaveRequest[K],
) => void;

/** The values of a generic test's form; validation is each control's own `required`. */
const useTestFormValues = (): {
  values: SaveRequest;
  setValue: SetTestFormValue;
  reset: () => void;
} => {
  const [values, setValues] = useState<SaveRequest>({});
  const setValue: SetTestFormValue = (name, value) =>
    setValues((prev) => ({ ...prev, [name]: value }));
  return { values, setValue, reset: () => setValues({}) };
};

export default useTestFormValues;
