import { DbtGenericTests } from "@modules/documentationEditor/state/types";

export interface SaveRequest {
  to?: string | undefined;
  field?: string | undefined;
  accepted_values?: string[] | undefined;
  test?: DbtGenericTests | undefined;
}
