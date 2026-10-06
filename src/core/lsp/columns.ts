import { inferredColumns, type CurrentNodeResult } from "../lineage";
import type { DBColumn } from "../types";

/**
 * A model's columns from a `dbt.getCurrentNode` result, in the server's spelling. `undefined` when the result names
 * no node or no columns (the server returns `columns: {}` in `baseline`), so the caller falls back to the CLI.
 */
export function dbColumnsFrom(
  result: CurrentNodeResult | undefined,
): DBColumn[] | undefined {
  const columns = inferredColumns(result);
  return columns && columns.length > 0
    ? columns.map(({ name, datatype }) => ({ column: name, dtype: datatype }))
    : undefined;
}
