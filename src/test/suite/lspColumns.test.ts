import { describe, expect, it } from "vitest";
import { dbColumnsFrom } from "../../core/lsp/columns";

describe("dbColumnsFrom", () => {
  it("maps columns in server order and spelling", () => {
    expect(
      dbColumnsFrom({
        node: {
          columns: { ORDER_ID: { data_type: "INTEGER" }, total: null },
        },
      }),
    ).toEqual([
      { column: "ORDER_ID", dtype: "integer" },
      { column: "total", dtype: "" },
    ]);
  });
});
