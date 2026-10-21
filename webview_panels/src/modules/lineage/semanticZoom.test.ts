import { describe, expect, it } from "vitest";
import { isZoomedOut } from "./semanticZoom";

describe("isZoomedOut", () => {
  it("is true only below 50% zoom", () => {
    expect(isZoomedOut(0.49, true)).toBe(true);
    expect(isZoomedOut(0.5, true)).toBe(false);
    expect(isZoomedOut(0.51, true)).toBe(false);
  });

  it("is false at any zoom when the setting is off", () => {
    expect(isZoomedOut(0.1, false)).toBe(false);
  });
});
