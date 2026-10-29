import { describe, expect, it } from "vitest";
import {
  minimapColour,
  minimapShown,
  minimapSize,
  minimapStroke,
} from "./minimap";

describe("minimapSize", () => {
  it("is a fifth of the canvas", () => {
    expect(minimapSize({ width: 800, height: 450 })).toEqual({
      width: 160,
      height: 90,
    });
  });

  it("rounds to whole pixels", () => {
    expect(minimapSize({ width: 637, height: 637 })).toEqual({
      width: 127,
      height: 127,
    });
    expect(minimapSize({ width: 637.5, height: 637.5 })).toEqual({
      width: 128,
      height: 128,
    });
  });

  it("clamps the minimum at 120x80", () => {
    expect(minimapSize({ width: 0, height: 0 })).toEqual({
      width: 120,
      height: 80,
    });
    expect(minimapSize({ width: 600, height: 400 })).toEqual({
      width: 120,
      height: 80,
    });
  });

  it("clamps the maximum at 200x150", () => {
    expect(minimapSize({ width: 1000, height: 750 })).toEqual({
      width: 200,
      height: 150,
    });
    expect(minimapSize({ width: 5000, height: 5000 })).toEqual({
      width: 200,
      height: 150,
    });
  });

  it("clamps each axis on its own", () => {
    expect(minimapSize({ width: 5000, height: 100 })).toEqual({
      width: 200,
      height: 80,
    });
  });
});

describe("minimapShown", () => {
  const roomy = { width: 720, height: 360 };

  it("shows a minimap on a canvas of at least 720x360 when the user has not chosen", () => {
    expect(minimapShown(undefined, roomy)).toBe(true);
    expect(minimapShown(undefined, { width: 1920, height: 1080 })).toBe(true);
  });

  it("hides it below 720x360 when the user has not chosen", () => {
    expect(minimapShown(undefined, { width: 719, height: 360 })).toBe(false);
    expect(minimapShown(undefined, { width: 720, height: 359 })).toBe(false);
    expect(minimapShown(undefined, { width: 400, height: 300 })).toBe(false);
  });

  it("follows the user's choice over the canvas size", () => {
    expect(minimapShown(true, { width: 400, height: 300 })).toBe(true);
    expect(minimapShown(false, roomy)).toBe(false);
  });

  it("never shows it on an unmeasured canvas, even when chosen", () => {
    expect(minimapShown(undefined, { width: 0, height: 0 })).toBe(false);
    expect(minimapShown(true, { width: 0, height: 0 })).toBe(false);
    expect(minimapShown(true, { width: 0, height: 360 })).toBe(false);
  });
});

describe("minimapColour", () => {
  it("leaves band nodes transparent", () => {
    expect(minimapColour({ type: "band" })).toBe("transparent");
  });

  it("colours every other node with the editor widget border", () => {
    const expected =
      "var(--vscode-editorWidget-border, var(--vscode-disabledForeground))";
    expect(minimapColour({ type: "table" })).toBe(expected);
    expect(minimapColour({ type: "folderGroup" })).toBe(expected);
    expect(minimapColour({})).toBe(expected);
  });
});

describe("minimapStroke", () => {
  it("leaves band nodes transparent", () => {
    expect(minimapStroke({ type: "band" })).toBe("transparent");
  });

  it("strokes every other node with the focus border", () => {
    expect(minimapStroke({ type: "table" })).toBe("var(--vscode-focusBorder)");
    expect(minimapStroke({})).toBe("var(--vscode-focusBorder)");
  });
});
