import { DbtGenericTests } from "@modules/documentationEditor/state/types";
import { describe, expect, it } from "vitest";
import { isTestFormComplete } from "./isTestFormComplete";

describe("isTestFormComplete", () => {
  it("requires at least one accepted value", () => {
    expect(isTestFormComplete(DbtGenericTests.ACCEPTED_VALUES, {})).toBe(false);
    expect(
      isTestFormComplete(DbtGenericTests.ACCEPTED_VALUES, {
        accepted_values: [],
      }),
    ).toBe(false);
    expect(
      isTestFormComplete(DbtGenericTests.ACCEPTED_VALUES, {
        accepted_values: ["a"],
      }),
    ).toBe(true);
  });

  it("requires both the related model and its field", () => {
    const test = DbtGenericTests.RELATIONSHIPS;
    expect(isTestFormComplete(test, { to: "ref('a')" })).toBe(false);
    expect(isTestFormComplete(test, { field: "id" })).toBe(false);
    expect(isTestFormComplete(test, { to: "ref('a')", field: "id" })).toBe(
      true,
    );
  });

  it("needs nothing for tests without arguments", () => {
    expect(isTestFormComplete(DbtGenericTests.UNIQUE, {})).toBe(true);
    expect(isTestFormComplete(undefined, {})).toBe(true);
  });
});
