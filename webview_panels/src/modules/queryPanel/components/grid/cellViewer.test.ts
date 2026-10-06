import { describe, expect, it } from "vitest";
import { cellViewerKind, cellViewerText } from "./cellViewer";

describe("cellViewerKind", () => {
  it("opens JSON objects and arrays as JSON regardless of width", () => {
    expect(cellViewerKind('{"a":1}', 1000)).toBe("json");
    expect(cellViewerKind("[1,2]", 1000)).toBe("json");
  });

  it("opens text that overflows its cell as a string", () => {
    expect(cellViewerKind("a long note", 50)).toBe("string");
  });

  it("leaves short text and JSON scalars alone", () => {
    expect(cellViewerKind("ok", 200)).toBeUndefined();
    expect(cellViewerKind("42", 200)).toBeUndefined();
    expect(cellViewerKind("null", 200)).toBeUndefined();
  });
});

describe("cellViewerText", () => {
  it("pretty-prints JSON", () => {
    expect(cellViewerText("json", '{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("breaks long text every 45 characters", () => {
    expect(cellViewerText("string", "x".repeat(100))).toBe(
      `${"x".repeat(45)}\n${"x".repeat(45)}\n${"x".repeat(10)}`,
    );
  });
});
