import { ColumnLineage } from "../../core/lineage";
import {
  ConnectedColumnsResult,
  describeNoLineage,
  NoLineage,
  TargetFailure,
} from "./dbtLineageService";

/** The lineage component shows `errors[table]` as a tooltip on that table. */
function noLineageErrors(
  targets: [string, string][],
  reason: NoLineage,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [table] of targets) {
    errors[table] = [describeNoLineage(reason)];
  }
  return errors;
}

/** One tooltip line per failed column, on the column's table. */
function partialFailureErrors(
  failures: TargetFailure[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const { target, message } of failures) {
    const [table, column] = target;
    (errors[table] ??= []).push(
      `Could not read column lineage for ${column}: ${message}`,
    );
  }
  return errors;
}

/** The lineage component's `getConnectedColumns` response body. */
export function connectedColumnsBody(
  result: ConnectedColumnsResult,
  targets: [string, string][],
): { column_lineage: ColumnLineage[]; errors?: Record<string, string[]> } {
  if (result.kind === "noLineage") {
    return {
      column_lineage: [],
      errors: noLineageErrors(targets, result.reason),
    };
  }
  return {
    column_lineage: result.columnLineage,
    ...(result.failures
      ? { errors: partialFailureErrors(result.failures) }
      : {}),
  };
}
