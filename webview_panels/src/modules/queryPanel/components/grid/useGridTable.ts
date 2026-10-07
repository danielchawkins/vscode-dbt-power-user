import { TableData } from "@modules/queryPanel/context/types";
import { ReactTable, useTable } from "@tanstack/react-table";
import { useMemo } from "react";
import { buildGridInit, GridColumnType } from "./columnTypeMapping";
import {
  columnHelper,
  DEFAULT_COLUMN_WIDTH,
  gridFeatures,
  GridRow,
} from "./gridTable";

/** The query result as a sortable, resizable table; numbers sort numerically and everything else as text. */
export function useGridTable(
  columnNames: string[],
  columnTypes: (string | null)[],
  data: TableData,
): {
  table: ReactTable<typeof gridFeatures, GridRow>;
  schema: Record<string, GridColumnType>;
  rows: GridRow[];
} {
  const { schema, rows } = useMemo(
    () => buildGridInit(columnNames, columnTypes, data),
    [columnNames, columnTypes, data],
  );
  const columns = useMemo(
    () =>
      columnHelper.columns(
        columnNames.map((name) =>
          columnHelper.accessor((row) => row[name], {
            id: name,
            header: name,
            size: DEFAULT_COLUMN_WIDTH,
            minSize: 48,
            sortFn: schema[name] === "number" ? "basic" : "alphanumeric",
            sortUndefined: "last",
          }),
        ),
      ),
    [columnNames, schema],
  );
  const table = useTable({
    features: gridFeatures,
    columns,
    data: rows,
    columnResizeMode: "onChange",
  });
  return { table, schema, rows };
}
