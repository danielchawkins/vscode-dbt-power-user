import {
  columnResizingFeature,
  columnSizingFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
} from "@tanstack/react-table";

export type GridRow = Record<string, unknown>;

/** Sorting and column sizing; stable at module scope as the table requires. */
export const gridFeatures = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  columnResizingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});

export const columnHelper = createColumnHelper<typeof gridFeatures, GridRow>();

export const ROW_HEIGHT = 26;
export const DEFAULT_COLUMN_WIDTH = 160;
