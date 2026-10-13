import { describe, expect, it } from "vitest";
import { extHostStartMs } from "../smoke/extHostStart";

describe("extHostStartMs", () => {
  it("returns the whole milliseconds from the launch to the callback", () => {
    expect(extHostStartMs("1000", 1_850.4)).toBe(850);
    expect(extHostStartMs("1000", 1_850.6)).toBe(851);
    expect(extHostStartMs("1000", 1_000)).toBe(0);
  });

  it("gives undefined when the launch time is unset, empty, or malformed", () => {
    expect(extHostStartMs(undefined, 2_000)).toBeUndefined();
    expect(extHostStartMs("", 2_000)).toBeUndefined();
    expect(extHostStartMs("   ", 2_000)).toBeUndefined();
    expect(extHostStartMs("soon", 2_000)).toBeUndefined();
    expect(extHostStartMs("0", 2_000)).toBeUndefined();
  });

  it("gives undefined when the callback would precede the launch", () => {
    expect(extHostStartMs("2000", 1_999)).toBeUndefined();
  });
});
