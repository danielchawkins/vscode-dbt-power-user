/** A rectangular selection: the cell where it started and the cell it currently extends to. */
export interface GridSelection {
  anchor: { row: number; col: number };
  focus: { row: number; col: number };
}

/**
 * The inclusive bounds of a selection, whichever corner is the anchor.
 * @internal
 */
export function selectionBounds(selection: GridSelection): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const { anchor, focus } = selection;
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

/** Whether a cell lies inside the selection. */
export function isSelected(
  selection: GridSelection | undefined,
  row: number,
  col: number,
): boolean {
  if (!selection) {
    return false;
  }
  const { top, bottom, left, right } = selectionBounds(selection);
  return row >= top && row <= bottom && col >= left && col <= right;
}

/** Tab-separated text of the selected cells, one line per row, as spreadsheets paste it. */
export function selectionToTsv(
  selection: GridSelection,
  cellText: (row: number, col: number) => string,
): string {
  const { top, bottom, left, right } = selectionBounds(selection);
  const lines: string[] = [];
  for (let row = top; row <= bottom; row++) {
    const cells: string[] = [];
    for (let col = left; col <= right; col++) {
      cells.push(cellText(row, col).replace(/[\t\r\n]+/g, " "));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}
