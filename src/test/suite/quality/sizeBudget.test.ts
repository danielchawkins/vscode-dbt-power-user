import { describe, expect, it } from "vitest";
import { overBudget } from "../../../../scripts/quality/size-budget.mjs";

describe("overBudget", () => {
  it.each([
    {
      name: "accepts sizes at or under budget",
      budgets: { a: 10, b: 5 },
      sizes: { a: 10, b: 1 },
      problems: [],
    },
    {
      name: "reports a size over budget",
      budgets: { a: 10 },
      sizes: { a: 11 },
      problems: ["a: 11 bytes, over the budget of 10"],
    },
    {
      name: "reports a missing artifact",
      budgets: { a: 10 },
      sizes: {},
      problems: ["a: not built"],
    },
  ])("$name", ({ budgets, sizes, problems }) => {
    expect(overBudget(budgets, sizes)).toEqual(problems);
  });
});
