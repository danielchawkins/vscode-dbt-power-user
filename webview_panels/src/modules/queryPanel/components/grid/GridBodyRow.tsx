import { Row } from "@tanstack/react-table";
import { MouseEvent } from "react";
import { cellViewerKind } from "./cellViewer";
import { formatCell, GridColumnType } from "./columnTypeMapping";
import classes from "./grid.module.css";
import { GridSelection, isSelected } from "./gridSelection";
import type { gridFeatures, GridRow } from "./gridTable";
import OpenIcon from "./openIcon.svg?react";

interface Props {
  row: Row<typeof gridFeatures, GridRow>;
  index: number;
  start: number;
  height: number;
  schema: Record<string, GridColumnType>;
  selection: GridSelection | undefined;
  onCellMouseDown: (event: MouseEvent, row: number, col: number) => void;
  onCellMouseEnter: (row: number, col: number) => void;
  onOpenViewer: (
    column: string,
    kind: "json" | "string",
    value: string,
  ) => void;
}

/** One virtualized body row. */
const GridBodyRow = ({
  row,
  index,
  start,
  height,
  schema,
  selection,
  onCellMouseDown,
  onCellMouseEnter,
  onOpenViewer,
}: Props): React.JSX.Element => (
  <div
    className={classes.row}
    role="row"
    aria-rowindex={index + 2}
    style={{ height, transform: `translateY(${start}px)` }}
  >
    {row.getAllCells().map((cell, col) => {
      const value = cell.getValue();
      const kind =
        typeof value === "string"
          ? cellViewerKind(value, cell.column.getSize())
          : undefined;
      const selected = isSelected(selection, index, col);
      const numeric = schema[cell.column.id] === "number";
      return (
        <div
          key={cell.id}
          className={[
            classes.cell,
            selected ? classes.selected : "",
            numeric ? classes.number : "",
          ].join(" ")}
          role="gridcell"
          tabIndex={-1}
          aria-selected={selected}
          style={{ width: cell.column.getSize() }}
          onMouseDown={(event) => onCellMouseDown(event, index, col)}
          onMouseEnter={() => onCellMouseEnter(index, col)}
        >
          <span className={classes.cellText}>{formatCell(value)}</span>
          {kind && typeof value === "string" ? (
            <button
              type="button"
              className={classes.openIcon}
              title="Click to view complete value"
              aria-label="View complete value"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => onOpenViewer(cell.column.id, kind, value)}
            >
              <OpenIcon />
            </button>
          ) : null}
        </div>
      );
    })}
  </div>
);

export default GridBodyRow;
