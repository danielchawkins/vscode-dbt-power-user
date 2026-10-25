import { describe, expect, it, vi } from "vitest";
import { QueryExecution } from "../../core/dbtCommand";
import {
  normalizeQueryLimit,
  runSqlNow,
  startSql,
} from "../../projects/project/projectSql";

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

describe("runSqlNow", () => {
  it("throws for a non-positive limit without calling the CLI", async () => {
    const executeSQL = vi.fn<never>();
    await expect(
      runSqlNow(
        { executeSQL },
        { query: "select 1", modelName: "model", limit: 0 },
      ),
    ).rejects.toThrow("Limit must be greater than 0");
    expect(executeSQL).not.toHaveBeenCalled();
  });
});

describe("startSql", () => {
  it("reports every column type as unknown", async () => {
    // Mirrors the published integration's real dbt show --output json shape: real row
    // values, but column_types fabricated as the literal string "string" for every column.
    const executeSQL = vi.fn(
      async () =>
        new QueryExecution(
          async () => undefined,
          async () => ({
            table: {
              column_names: ["a", "b"],
              column_types: ["string", "string"],
              rows: [[1, "x"]],
            },
            compiled_sql: "select 1 as a, 'x' as b",
            raw_sql: "select 1 as a, 'x' as b",
            modelName: "my_model",
          }),
        ),
    );

    const execution = await startSql(
      { executeSQL },
      { query: "select 1 as a, 'x' as b", modelName: "my_model", limit: 500 },
    );
    const result = await execution.executeQuery();

    expect(executeSQL).toHaveBeenCalled();
    expect(result.table.column_types).toEqual([null, null]);
    expect(result.table.column_names).toEqual(["a", "b"]);
  });

  it("forwards cancellation to the underlying query execution", async () => {
    const cancel = vi.fn(async () => undefined);
    const executeSQL = vi.fn(
      async () =>
        new QueryExecution(cancel, async () => {
          throw new Error("should not execute after cancel in this test");
        }),
    );

    const execution = await startSql(
      { executeSQL },
      { query: "select 1", modelName: "my_model", limit: 500 },
    );
    await execution.cancel();

    expect(cancel).toHaveBeenCalled();
  });
});
