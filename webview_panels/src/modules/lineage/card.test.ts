import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import {
  cardBadge,
  cardFile,
  cardSubtitle,
  cardTitle,
  cardTooltip,
  packageNameOf,
} from "./card";

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

  it("puts the unique ID, alias, file, package, ref and relation in the tooltip", () => {
    expect(
      cardTooltip(
        table({
          label: "grant_cash_advance_commitments",
          refName: "int__grant_cash_advance_commitments",
          path: "models/int__grant_cash_advance_commitments.sql",
          packageName: "fg",
          database: "DEV_FG",
          schema: "commitment",
          layer: "intermediate",
        }),
      ).split("\n"),
    ).toEqual([
      "model.fg.int__grant_cash_advance_commitments",
      "alias: grant_cash_advance_commitments",
      "models/int__grant_cash_advance_commitments.sql",
      "fg.model",
      "ref('int__grant_cash_advance_commitments')",
      "relation: DEV_FG.commitment.grant_cash_advance_commitments",
      "intermediate layer",
    ]);
  });

  it("leaves the alias out of the tooltip when it is the file name", () => {
    const lines = cardTooltip(
      table({ label: "orders", path: "models/orders.sql" }),
    ).split("\n");
    expect(lines.some((line) => line.startsWith("alias:"))).toBe(false);
    expect(lines).toContain("ref('orders')");
  });

  describe("title modes", () => {
    const aliased = table({
      label: "summary_mart",
      refName: "mart_summary",
      path: "models/mart_summary.sql",
      database: "DEV",
      schema: "marts",
      materialization: "table",
    });
    const source = table({
      table: "source.fg.raw.orders",
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
      expect(cardTitle(source, "alias")).toBe("raw.orders");
      expect(cardTitle(source, "name")).toBe("raw.orders");
    });

    it("leads a source title with its source name and table name", () => {
      const other = table({
        table: "source.fg.stripe.payments",
        label: "payments",
        nodeType: "source",
      });
      expect(cardTitle(other, "alias")).toBe("stripe.payments");
      expect(cardTitle(other, "name")).toBe("stripe.payments");
    });

    it("shows the file line only when the title is not the file name", () => {
      expect(cardFile(aliased, "alias")).toBe("mart_summary");
      expect(cardFile(aliased, "name")).toBeUndefined();
      expect(
        cardFile(table({ label: "orders", path: "models/orders.sql" })),
      ).toBeUndefined();
      expect(cardFile(source)).toBeUndefined();
    });

    it("keeps a dotted file name's stem, dropping only the extension", () => {
      expect(
        cardFile(
          table({ label: "orders_v2", path: "models/a/orders.v1.sql" }),
          "alias",
        ),
      ).toBe("orders.v1");
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

    it("puts the ref or source call, the path and the relation in the tooltip", () => {
      expect(cardTooltip(aliased).split("\n")).toEqual([
        "model.fg.int__grant_cash_advance_commitments",
        "alias: summary_mart",
        "models/mart_summary.sql",
        "fg.model",
        "ref('mart_summary')",
        "relation: DEV.marts.summary_mart",
      ]);
      expect(cardTooltip(source).split("\n")).toEqual([
        "source.fg.raw.orders",
        "fg.source",
        "source('raw', 'orders')",
        "relation: RAW.shop.ORDERS_V2",
      ]);
    });
  });

  it("falls back to the unique ID's package for a node with no package name", () => {
    const metric = table({
      table: "metric.fg.revenue",
      label: "revenue",
      nodeType: "metric",
    });
    expect(packageNameOf(metric)).toBe("fg");
    expect(packageNameOf(table({ packageName: "other" }))).toBe("other");
    expect(cardTooltip(metric).split("\n")).toContain("fg.metric");
  });
});
