import type { ColumnRef } from "@fusion-power-user/webview-contract/columnProposals";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { columnEdges } from "../../core/lineage/columnLineage";
import {
  declaredDescription,
  descriptionCandidates,
  toDescriptionProposal,
} from "../../core/lineage/upstreamDescriptions";
import { esmDirname } from "../esmDirname";

const FUSION_2_0_6_TOTAL = JSON.parse(
  readFileSync(
    path.join(
      esmDirname(import.meta.url),
      "fixtures",
      "fusion-lsp-2.0.6",
      "listnodes-order-totals-total.json",
    ),
    "utf8",
  ),
);

const ORDER_TOTAL: ColumnRef = {
  uniqueId: "model.lineage_probe.order_totals",
  column: "total",
};
const GRAND_TOTAL: ColumnRef = {
  uniqueId: "model.lineage_probe.totals_downstream",
  column: "grand_total",
};

/** A `dbt.listNodes` node: the column `name` of `node`, its evolution `op` and its parent column ids. */
function node(
  id: string,
  op: string,
  parents: string[] = [],
): Record<string, unknown> {
  const name = id.slice(id.lastIndexOf(".") + 1);
  return { unique_id: id, name, op, parents };
}

/** Edges of the given nodes, in the shape `columnEdges` returns for a column-grain result. */
const edgesOf = (...nodes: Record<string, unknown>[]) => columnEdges({ nodes });

/** A description lookup over a fixed table, keyed by `uniqueId.column`. */
const describeFrom =
  (table: Record<string, string>) =>
  (ref: ColumnRef): string | undefined =>
    table[`${ref.uniqueId}.${ref.column}`];

describe("descriptionCandidates on captured Fusion 2.0.6 output", () => {
  const edges = columnEdges(FUSION_2_0_6_TOTAL);

  it("takes the described parent of a copy as a hit", () => {
    const hits = descriptionCandidates(
      edges,
      GRAND_TOTAL,
      describeFrom({ "model.lineage_probe.order_totals.total": "Order total" }),
    );
    expect(hits).toEqual([{ description: "Order total", source: ORDER_TOTAL }]);
  });

  it("follows a rename to the parent's own column name", () => {
    const hits = descriptionCandidates(
      edges,
      GRAND_TOTAL,
      describeFrom({ "model.lineage_probe.order_totals.total": "Order total" }),
    );
    expect(hits[0]?.source.column).toBe("total");
  });

  it("stops at a mod: the mod's own parent is not walked", () => {
    const hits = descriptionCandidates(
      edges,
      ORDER_TOTAL,
      describeFrom({
        "model.lineage_probe.stg_orders.amount": "Order amount",
      }),
    );
    expect(hits).toEqual([]);
  });
});

describe("descriptionCandidates", () => {
  it("returns the first described copy ancestor of a select *", () => {
    const edges = edgesOf(
      node("m.p.child.a", "copy", ["m.p.parent.a"]),
      node("m.p.parent.a", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "m.p.child", column: "a" },
      describeFrom({ "m.p.parent.a": "Parent a" }),
    );
    expect(hits).toEqual([
      {
        description: "Parent a",
        source: { uniqueId: "m.p.parent", column: "a" },
      },
    ]);
  });

  it("stops at an undescribed scan ancestor", () => {
    const edges = edgesOf(
      node("m.p.child.a", "copy", ["m.p.mid.a"]),
      node("m.p.mid.a", "scan", ["m.p.root.a"]),
      node("m.p.root.a", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "m.p.child", column: "a" },
      describeFrom({ "m.p.root.a": "Root" }),
    );
    expect(hits).toEqual([]);
  });

  it("walks through an undescribed copy to a described ancestor", () => {
    const edges = edgesOf(
      node("m.p.c.a", "copy", ["m.p.b.a"]),
      node("m.p.b.a", "copy", ["m.p.a.a"]),
      node("m.p.a.a", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "m.p.c", column: "a" },
      describeFrom({ "m.p.a.a": "Source" }),
    );
    expect(hits).toEqual([
      { description: "Source", source: { uniqueId: "m.p.a", column: "a" } },
    ]);
  });

  it("does not walk past an undescribed mod", () => {
    const edges = edgesOf(
      node("m.p.c.a", "copy", ["m.p.b.a"]),
      node("m.p.b.a", "mod", ["m.p.a.a"]),
      node("m.p.a.a", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "m.p.c", column: "a" },
      describeFrom({ "m.p.a.a": "Source" }),
    );
    expect(hits).toEqual([]);
  });

  it("returns every described branch of a UNION", () => {
    const edges = edgesOf(
      node("m.p.u.a", "copy", ["m.p.x.a", "m.p.y.a"]),
      node("m.p.x.a", "unknown"),
      node("m.p.y.a", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "m.p.u", column: "a" },
      describeFrom({ "m.p.x.a": "Same", "m.p.y.a": "Same" }),
    );
    expect(hits.map((h) => h.source.uniqueId)).toEqual(["m.p.x", "m.p.y"]);
  });

  it("terminates on a cycle", () => {
    const edges = edgesOf(
      node("m.p.a.x", "copy", ["m.p.b.x"]),
      node("m.p.b.x", "copy", ["m.p.a.x"]),
    );
    expect(
      descriptionCandidates(
        edges,
        { uniqueId: "m.p.a", column: "x" },
        () => undefined,
      ),
    ).toEqual([]);
  });

  it("matches ids and column names case-insensitively", () => {
    const edges = edgesOf(
      node("m.p.Child.Total", "copy", ["m.p.Parent.Total"]),
      node("m.p.Parent.Total", "unknown"),
    );
    const hits = descriptionCandidates(
      edges,
      { uniqueId: "M.P.CHILD", column: "total" },
      describeFrom({ "m.p.Parent.Total": "Parent total" }),
    );
    expect(hits).toHaveLength(1);
  });
});

describe("toDescriptionProposal", () => {
  it("gives one candidate with all its sources when the descriptions agree", () => {
    const hits = [
      { description: "Same", source: { uniqueId: "m.p.x", column: "a" } },
      { description: "Same", source: { uniqueId: "m.p.y", column: "a" } },
    ];
    expect(toDescriptionProposal(hits)).toEqual([
      {
        description: "Same",
        sources: [
          { uniqueId: "m.p.x", column: "a" },
          { uniqueId: "m.p.y", column: "a" },
        ],
      },
    ]);
  });

  it("gives one candidate per description when they differ", () => {
    const hits = [
      { description: "One", source: { uniqueId: "m.p.x", column: "a" } },
      { description: "Two", source: { uniqueId: "m.p.y", column: "a" } },
    ];
    expect(toDescriptionProposal(hits).map((c) => c.description)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("trims descriptions before grouping them", () => {
    const hits = [
      { description: "  Same ", source: { uniqueId: "m.p.x", column: "a" } },
      { description: "Same", source: { uniqueId: "m.p.y", column: "a" } },
    ];
    expect(toDescriptionProposal(hits)).toHaveLength(1);
  });

  it("gives no candidate for no hits", () => {
    expect(toDescriptionProposal([])).toEqual([]);
  });
});

describe("declaredDescription", () => {
  const nodeMetaMap = {
    lookupByUniqueId: (id: string) =>
      id === "model.p.orders"
        ? {
            columns: {
              Amount: { description: "  Order amount  " },
              blank: { description: "   " },
            },
          }
        : undefined,
  };
  const sourceMetaMap = new Map([
    [
      "raw",
      {
        tables: [
          {
            name: "orders",
            columns: { amount: { description: "Raw amount" } },
          },
        ],
      },
    ],
  ]);
  const maps = {
    nodeMetaMap,
    sourceMetaMap,
  } as unknown as Parameters<typeof declaredDescription>[0];

  it("finds a model column case-insensitively and trims it", () => {
    expect(
      declaredDescription(maps, {
        uniqueId: "model.p.orders",
        column: "amount",
      }),
    ).toBe("Order amount");
  });

  it("finds a source column under its source group and table", () => {
    expect(
      declaredDescription(maps, {
        uniqueId: "source.p.raw.orders",
        column: "amount",
      }),
    ).toBe("Raw amount");
  });

  it("gives undefined for a blank, missing or unknown column", () => {
    expect(
      declaredDescription(maps, {
        uniqueId: "model.p.orders",
        column: "blank",
      }),
    ).toBeUndefined();
    expect(
      declaredDescription(maps, { uniqueId: "model.p.orders", column: "x" }),
    ).toBeUndefined();
    expect(
      declaredDescription(maps, {
        uniqueId: "model.p.other",
        column: "amount",
      }),
    ).toBeUndefined();
    expect(
      declaredDescription(maps, {
        uniqueId: "source.p.raw.nope",
        column: "amount",
      }),
    ).toBeUndefined();
  });
});
