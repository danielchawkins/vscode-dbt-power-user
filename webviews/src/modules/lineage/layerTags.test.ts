import { describe, expect, it } from "vitest";
import { bandColour, layerTagOf } from "./layerTags";

describe("layerTagOf", () => {
  it("puts sources and seeds in the source band", () => {
    expect(layerTagOf("source", undefined)).toBe("source");
    expect(layerTagOf("seed", "marts")).toBe("source");
  });

  it("uses the table layer, and falls back to other when there is none", () => {
    expect(layerTagOf("model", "staging")).toBe("staging");
    expect(layerTagOf("model", undefined)).toBe("other");
    expect(layerTagOf("model", "")).toBe("other");
  });
});

describe("bandColour", () => {
  const as = (value: string) => bandColour("marts", { marts: value });
  const palette = "var(--vscode-charts-green)";

  it("uses the theme charts palette by default", () => {
    expect(bandColour("source")).toBe("var(--vscode-charts-orange)");
    expect(bandColour("staging")).toBe("var(--vscode-charts-blue)");
    expect(bandColour("finance")).toBe("var(--vscode-charts-yellow)");
  });

  it("maps a theme colour id to its VS Code variable, matching the tag case-insensitively", () => {
    expect(as("charts.red")).toBe("var(--vscode-charts-red)");
    expect(as(" terminal.ansiCyan ")).toBe("var(--vscode-terminal-ansiCyan)");
    expect(bandColour("staging", { Staging: "charts.red" })).toBe(
      "var(--vscode-charts-red)",
    );
  });

  it("keeps a hex or colour function as written", () => {
    expect(as("#e06c75")).toBe("#e06c75");
    expect(as("oklch(70% 0.15 250)")).toBe("oklch(70% 0.15 250)");
  });

  it("rejects anything else, including text that could escape the declaration", () => {
    expect(as("red")).toBe(palette);
    expect(as("#zzz")).toBe(palette);
    expect(as("rgb(0,0,0); color: red")).toBe(palette);
    expect(as("url(x)")).toBe(palette);
  });
});
