import { ClipboardEvent, MouseEvent, useRef, useState } from "react";
import { formatCell } from "./columnTypeMapping";
import { GridSelection, selectionToTsv } from "./gridSelection";

interface RowLike {
  getAllCells(): { getValue(): unknown }[];
}

/** Cell and range selection by click, shift-click and drag, and copy of the range as tab-separated text. */
export function useGridSelection(bodyRows: RowLike[]): {
  selection: GridSelection | undefined;
  onCopy: (event: ClipboardEvent) => void;
  onCellMouseDown: (event: MouseEvent, row: number, col: number) => void;
  onCellMouseEnter: (row: number, col: number) => void;
  stopDragging: () => void;
} {
  const draggingRef = useRef(false);
  const [selection, setSelection] = useState<GridSelection | undefined>();

  const onCopy = (event: ClipboardEvent) => {
    if (!selection) {
      return;
    }
    const text = selectionToTsv(selection, (row, col) =>
      formatCell(bodyRows[row]?.getAllCells()[col]?.getValue()),
    );
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };

  const onCellMouseDown = (event: MouseEvent, row: number, col: number) => {
    if (event.button !== 0) {
      return;
    }
    draggingRef.current = true;
    setSelection((prev) =>
      event.shiftKey && prev
        ? { anchor: prev.anchor, focus: { row, col } }
        : { anchor: { row, col }, focus: { row, col } },
    );
  };

  const onCellMouseEnter = (row: number, col: number) => {
    if (draggingRef.current) {
      setSelection((prev) =>
        prev ? { anchor: prev.anchor, focus: { row, col } } : prev,
      );
    }
  };

  const stopDragging = () => {
    draggingRef.current = false;
  };

  return {
    selection,
    onCopy,
    onCellMouseDown,
    onCellMouseEnter,
    stopDragging,
  };
}
