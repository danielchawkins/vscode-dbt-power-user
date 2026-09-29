import { describe, expect, it, jest } from "@jest/globals";
import { executeSql, normalizeQueryLimit } from "../../projects/projectSql";

describe("normalizeQueryLimit", () => {
  it("strips a trailing semicolon", () => {
    expect(normalizeQueryLimit("select 1;  ", 500)).toEqual({
      query: "select 1",
      limit: 500,
    });
  });

  it("lets a trailing LIMIT n override the requested limit", () => {
    expect(normalizeQueryLimit("select * from t limit 10;", 500)).toEqual({
      query: "select * from t",
      limit: 10,
    });
  });

  it("strips a trailing LIMIT followed by a comment", () => {
    expect(
      normalizeQueryLimit("select * from t LIMIT 7 -- sample", 500),
    ).toEqual({ query: "select * from t", limit: 7 });
  });

  it("keeps the requested limit when the trailing LIMIT is zero", () => {
    expect(normalizeQueryLimit("select * from t limit 0", 500)).toEqual({
      query: "select * from t",
      limit: 500,
    });
  });
});

describe("executeSql", () => {
  it("throws for a non-positive limit without calling the CLI", async () => {
    const executeSQL = jest.fn<never>();
    await expect(
      executeSql({ executeSQL }, "select 1", "model", 0, true),
    ).rejects.toThrow("Limit must be greater than 0");
    expect(executeSQL).not.toHaveBeenCalled();
  });
});
