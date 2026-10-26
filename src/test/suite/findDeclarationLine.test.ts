import { describe, expect, it } from "vitest";

import { findDeclarationLine } from "../../core/manifest/utils";

describe("findDeclarationLine", () => {
  it("returns the index of the first line that declares the name", () => {
    const text = "-- header\n{% docs orders %}\nbody\n{% docs orders %}";
    expect(findDeclarationLine(text, "docs", "orders")).toBe(1);
  });

  it("returns undefined when no line declares the name", () => {
    expect(
      findDeclarationLine("{% docs other %}", "docs", "orders"),
    ).toBeUndefined();
  });

  it("matches regex metacharacters in the name literally", () => {
    expect(
      findDeclarationLine("{% docs axb %}", "docs", "a.b"),
    ).toBeUndefined();
    expect(findDeclarationLine("x\n{% docs a.b %}", "docs", "a.b")).toBe(1);
  });

  it("requires a call when the name ends with an open parenthesis", () => {
    const text = "{% macro cents_total %}\n{% macro cents(amount) %}";
    expect(findDeclarationLine(text, "macro", "cents(")).toBe(1);
  });
});
