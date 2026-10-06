import { describe, expect, it } from "vitest";
import { overBudget } from "../../../../scripts/quality/size-budget.mjs";

describe("overBudget", () => {
  it("accepts sizes at or under budget", () => {
    expect(overBudget({ a: 10, b: 5 }, { a: 10, b: 1 })).toEqual([]);
  });

  it("reports a size over budget", () => {
    expect(overBudget({ a: 10 }, { a: 11 })).toEqual([
      "a: 11 bytes, over the budget of 10",
    ]);
  });

  it("reports a missing artifact", () => {
    expect(overBudget({ a: 10 }, {})).toEqual(["a: not built"]);
  });
});
