import { describe, expect, it } from "vitest";
import { syntheticResult } from "../../features/queryResults/queryResultTestCommand";

describe("synthetic query result", () => {
  it("has one value per column in every row", () => {
    const result = syntheticResult(10_000);
    expect(result.table.rows).toHaveLength(10_000);
    for (const row of result.table.rows) {
      expect(row).toHaveLength(result.table.column_names.length);
    }
  });
});
