import { describe, expect, it } from "vitest";
import { isSelected, selectionBounds, selectionToTsv } from "./gridSelection";

const range = {
  anchor: { row: 2, col: 3 },
  focus: { row: 0, col: 1 },
};

describe("gridSelection", () => {
  it("normalises bounds whichever corner is the anchor", () => {
    expect(selectionBounds(range)).toEqual({
      top: 0,
      bottom: 2,
      left: 1,
      right: 3,
    });
  });

  it("tests cells against the range and treats no selection as empty", () => {
    expect(isSelected(range, 1, 2)).toBe(true);
    expect(isSelected(range, 3, 2)).toBe(false);
    expect(isSelected(range, 1, 0)).toBe(false);
    expect(isSelected(undefined, 0, 0)).toBe(false);
  });

  it("copies a range as tab-separated lines and flattens embedded separators", () => {
    const text = selectionToTsv(
      { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } },
      (row, col) => (row === 1 && col === 1 ? "a\tb\nc" : `${row}${col}`),
    );
    expect(text).toBe("00\t01\n10\ta b c");
  });
});
