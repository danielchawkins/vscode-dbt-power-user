import { Header } from "@tanstack/react-table";
import { KeyboardEvent } from "react";
import classes from "./grid.module.css";
import type { GridRow, gridFeatures } from "./gridTable";

type GridHeader = Header<typeof gridFeatures, GridRow, unknown>;

const ariaSort = (sorted: false | "asc" | "desc") => {
  if (sorted === "asc") {
    return "ascending";
  }
  return sorted === "desc" ? "descending" : "none";
};

const sortMark = (sorted: false | "asc" | "desc") => {
  if (sorted === "asc") {
    return "▲";
  }
  return sorted === "desc" ? "▼" : "";
};

/** A sortable, resizable column header. */
const GridHeaderCell = ({
  header,
}: {
  header: GridHeader;
}): React.JSX.Element => {
  const sorted = header.column.getIsSorted();
  const toggle = header.column.getToggleSortingHandler();
  const resize = header.getResizeHandler();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle?.(event);
    }
  };
  return (
    <div
      className={classes.headerCell}
      role="columnheader"
      tabIndex={0}
      aria-sort={ariaSort(sorted)}
      style={{ width: header.getSize() }}
      onClick={toggle}
      onKeyDown={onKeyDown}
    >
      <span className={classes.headerLabel}>{header.id}</span>
      <span className={classes.sortMark}>{sortMark(sorted)}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Resize column ${header.id}`}
        className={classes.resizer}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => {
          event.stopPropagation();
          resize(event);
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
          resize(event);
        }}
      />
    </div>
  );
};

export default GridHeaderCell;
