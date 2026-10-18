import type { lineage } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import { cardBadge, cardSubtitle, cardTooltip, middleEllipsis } from "./card";

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
    const short = middleEllipsis(
      "stg__backend_grant__cash_advance_repayments__log",
      30,
    );
    expect(short).toHaveLength(30);
    expect(short.startsWith("stg__backe")).toBe(true);
    expect(short.endsWith("repayments__log")).toBe(true);
    expect(short).toContain("…");
    expect(middleEllipsis("orders", 30)).toBe("orders");
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
});
