import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { cardBadge, cardSubtitle, cardTitle, cardTooltip } from "./card";

const table = (
  over: Partial<lineage.LineageTable> = {},
): lineage.LineageTable => ({
  table: "model.fg.int__grant_cash_advance_commitments",
  label: "grant_cash_advance_commitments",
  nodeType: "model",
  childCount: 1,
  parentCount: 4,
  tests: [],
  ...over,
});

describe("lineage card text", () => {
  it("keeps the end of a long name, where dbt names differ", () => {
    const short = cardTitle(
      table({ label: "stg__backend_grant__cash_advance_repayments__log" }),
      "alias",
    );
    expect(short).toHaveLength(30);
    expect(short.startsWith("stg__backe")).toBe(true);
    expect(short.endsWith("repayments__log")).toBe(true);
    expect(short).toContain("…");
    expect(cardTitle(table({ label: "orders" }), "alias")).toBe("orders");
  });

  it("shows the relation, materialization, and the package only when it is not the project's", () => {
    const own = table({
      database: "DEV_FG_INTERMEDIATE",
      schema: "commitment",
      materialization: "view",
      packageName: "fg",
      rootPackage: true,
    });
    expect(cardSubtitle(own)).toBe("DEV_FG_INTERMEDIATE.commitment · view");
    expect(cardSubtitle({ ...own, rootPackage: false })).toBe(
      "DEV_FG_INTERMEDIATE.commitment · view · fg",
    );
  });

  it("tells two same-alias nodes apart by their relation", () => {
    const a = table({ database: "DEV_STAGING", schema: "grant" });
    const b = table({ database: "DEV_STAGING", schema: "kikoff" });
    expect(cardSubtitle(a)).not.toBe(cardSubtitle(b));
  });

  it("keeps materialization and package for a node with no relation", () => {
    expect(
      cardSubtitle(
        table({
          nodeType: "function",
          materialization: "scalar function",
          packageName: "foundation",
        }),
      ),
    ).toBe("scalar function · foundation");
  });

  it("badges the layer when known, else the resource type", () => {
    expect(cardBadge(table({ layer: "intermediate" }))).toBe("intermediate");
    expect(cardBadge(table())).toBe("model");
  });

  it("shortens a schema ending in the custom schema to that schema, keeping the database", () => {
    const shortened = table({
      database: "DEV_FG",
      schema: "DBT_DEV_DANIEL_COMMITMENT",
      customSchema: "commitment",
    });
    expect(cardSubtitle(shortened)).toBe("DEV_FG.commitment");
    // Snowflake upper-cases names, so the match ignores case.
    expect(
      cardSubtitle({
        ...shortened,
        schema: "DBT_DEV_DANIEL_COMMITMENT",
        customSchema: "COMMITMENT",
      }),
    ).toBe("DEV_FG.COMMITMENT");
  });

  it("leaves the schema alone without a custom schema or when it does not end with one", () => {
    const base = table({ database: "DEV_FG", schema: "DBT_DEV_DANIEL_KIKOFF" });
    expect(cardSubtitle(base)).toBe("DEV_FG.DBT_DEV_DANIEL_KIKOFF");
    expect(cardSubtitle({ ...base, customSchema: "commitment" })).toBe(
      "DEV_FG.DBT_DEV_DANIEL_KIKOFF",
    );
    expect(
      cardSubtitle({
        ...base,
        schema: "commitment",
        customSchema: "commitment",
      }),
    ).toBe("DEV_FG.commitment");
  });

  it("keeps the full schema in the tooltip", () => {
    expect(
      cardTooltip(
        table({
          database: "DEV_FG",
          schema: "DBT_DEV_DANIEL_COMMITMENT",
          customSchema: "commitment",
          label: "orders",
        }),
      ),
    ).toContain("relation: DEV_FG.DBT_DEV_DANIEL_COMMITMENT.orders");
  });

  it("puts the unique ID, ref name and full relation in the tooltip", () => {
    expect(
      cardTooltip(
        table({
          refName: "int__grant_cash_advance_commitments",
          database: "DEV_FG",
          schema: "commitment",
          layer: "intermediate",
        }),
      ).split("\n"),
    ).toEqual([
      "model.fg.int__grant_cash_advance_commitments",
      "ref: int__grant_cash_advance_commitments",
      "relation: DEV_FG.commitment.grant_cash_advance_commitments",
      "model, intermediate layer",
    ]);
  });

  describe("title modes", () => {
    const aliased = table({
      label: "summary_mart",
      refName: "mart_summary",
      database: "DEV",
      schema: "marts",
      materialization: "table",
    });
    const source = table({
      label: "orders",
      refName: "raw.orders",
      identifier: "ORDERS_V2",
      database: "RAW",
      schema: "shop",
      nodeType: "source",
    });

    it("titles by alias or by dbt name", () => {
      expect(cardTitle(aliased, "alias")).toBe("summary_mart");
      expect(cardTitle(aliased, "name")).toBe("mart_summary");
      expect(cardTitle(table(), "name")).toBe("grant_cash_advance_commitments");
      expect(cardTitle(source, "alias")).toBe("orders");
      expect(cardTitle(source, "name")).toBe("raw.orders");
    });

    it("shortens to the zoomed length when zoomed", () => {
      const long = table({ label: "stg__backend_grant__cash_advance_log" });
      expect(cardTitle(long, "alias")).toHaveLength(30);
      expect(cardTitle(long, "name", true)).toHaveLength(15);
    });

    it("shows the alias in the name-mode subtitle only when it differs", () => {
      expect(cardSubtitle(aliased, "name")).toBe(
        "DEV.marts.summary_mart · table",
      );
      expect(cardSubtitle(aliased)).toBe("DEV.marts · table");
      const same = { ...aliased, refName: undefined };
      expect(cardSubtitle(same, "name")).toBe("DEV.marts · table");
      expect(cardSubtitle(source, "name")).toBe("RAW.shop.ORDERS_V2");
    });

    it("keeps the package and ephemeral rules in name mode", () => {
      const other = {
        ...aliased,
        packageName: "dbt_utils",
        rootPackage: false,
      };
      expect(cardSubtitle(other, "name")).toBe(
        "DEV.marts.summary_mart · table · dbt_utils",
      );
      const ephemeral = { ...aliased, schema: undefined, database: undefined };
      expect(cardSubtitle(ephemeral, "name")).toBe("table");
    });

    it("shows ref in alias mode and alias in name mode in the tooltip", () => {
      expect(cardTooltip(aliased).split("\n")).toEqual([
        "model.fg.int__grant_cash_advance_commitments",
        "ref: mart_summary",
        "relation: DEV.marts.summary_mart",
      ]);
      expect(cardTooltip(aliased, "name")).toContain("alias: summary_mart");
      expect(cardTooltip(aliased, "name")).not.toContain("ref:");
      expect(cardTooltip(source, "name")).toContain(
        "relation: RAW.shop.ORDERS_V2",
      );
      expect(cardTooltip(source, "name")).toContain("alias: ORDERS_V2");
    });
  });
});
