import { DbtGenericTests } from "@modules/documentationEditor/state/types";
import { SaveRequest } from "../types";

/** True when `values` fills every field the generic test `test` requires. */
export const isTestFormComplete = (
  test: string | undefined,
  values: SaveRequest,
): boolean => {
  if (test === DbtGenericTests.ACCEPTED_VALUES) {
    return Boolean(values.accepted_values?.length);
  }
  if (test === DbtGenericTests.RELATIONSHIPS) {
    return Boolean(values.to && values.field);
  }
  return true;
};
