import { columnProposals } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";

type Proposal = columnProposals.TypeProposal;

describe("applyProposals", () => {
  it("fills only a column whose type is still empty", () => {
    const proposals: Proposal[] = [
      { column: "id", type: "integer", change: "fill" },
      { column: "name", type: "varchar", change: "fill" },
    ];

    const applied = columnProposals.applyProposals(
      [
        { name: "id", type: "" },
        { name: "name", type: "text" },
      ],
      proposals,
    );

    expect(applied).toEqual([
      { name: "id", type: "integer" },
      { name: "name", type: "text" },
    ]);
  });

  it("overwrites only the ticked columns, and marks them replaceType", () => {
    const proposals: Proposal[] = [
      {
        column: "total",
        type: "decimal",
        change: "overwrite",
        current: "text",
      },
      {
        column: "count",
        type: "bigint",
        change: "overwrite",
        current: "text",
      },
    ];

    const applied = columnProposals.applyProposals(
      [
        { name: "total", type: "text" },
        { name: "count", type: "text" },
      ],
      proposals,
      { total: { overwrite: true } },
    );

    expect(applied).toEqual([
      { name: "total", type: "decimal", replaceType: true },
      { name: "count", type: "text" },
    ]);
  });

  it("keeps a value typed after the proposal arrived", () => {
    const proposals: Proposal[] = [
      { column: "id", type: "integer", change: "fill" },
      {
        column: "total",
        type: "decimal",
        change: "overwrite",
        current: "text",
      },
    ];

    const applied = columnProposals.applyProposals(
      [
        { name: "id", type: "bigint" },
        { name: "total", type: "varchar" },
      ],
      proposals,
      { id: { overwrite: true }, total: { overwrite: true } },
    );

    expect(applied).toEqual([
      { name: "id", type: "bigint" },
      { name: "total", type: "varchar" },
    ]);
  });

  it("appends an added column with the DATABASE source", () => {
    const proposals: Proposal[] = [
      { column: "order_count", type: "bigint", change: "add" },
    ];

    const applied = columnProposals.applyProposals(
      [{ name: "id", type: "integer", source: "YAML" }],
      proposals,
    );

    expect(applied).toEqual([
      { name: "id", type: "integer", source: "YAML" },
      { name: "order_count", type: "bigint", source: "DATABASE" },
    ]);
  });

  it("does not add a column the YAML already has, and leaves the input unchanged", () => {
    const columns = [{ name: "id", type: "integer" }];
    const proposals: Proposal[] = [
      { column: "ID", type: "bigint", change: "add" },
    ];

    const applied = columnProposals.applyProposals(columns, proposals);

    expect(applied).toEqual([{ name: "id", type: "integer" }]);
    expect(columns).toEqual([{ name: "id", type: "integer" }]);
  });
});

describe("applyDescriptionProposals", () => {
  const single: columnProposals.DescriptionProposal = {
    column: "grand_total",
    candidates: [
      {
        description: "Order total",
        sources: [{ uniqueId: "model.p.order_totals", column: "total" }],
      },
    ],
  };
  /** Two ancestors that disagree: a UNION column whose branches describe it differently. */
  const disagreeing: columnProposals.DescriptionProposal = {
    column: "amount",
    candidates: [
      {
        description: "Order total",
        sources: [{ uniqueId: "model.p.order_totals", column: "total" }],
      },
      {
        description: "Sum of totals",
        sources: [{ uniqueId: "model.p.other", column: "sum" }],
      },
    ],
  };

  it("fills a blank description from a single candidate", () => {
    const applied = columnProposals.applyDescriptionProposals(
      [
        { name: "grand_total", type: "decimal", description: "" },
        { name: "other", description: null },
      ],
      [single],
    );

    expect(applied).toEqual([
      { name: "grand_total", type: "decimal", description: "Order total" },
      { name: "other", description: null },
    ]);
  });

  it("skips a proposal with several candidates when no choice names one", () => {
    const columns = [{ name: "amount", description: "" }];
    const applied = columnProposals.applyDescriptionProposals(columns, [
      disagreeing,
    ]);

    expect(applied).toEqual([{ name: "amount", description: "" }]);
  });

  it("applies the candidate a choice names, keyed by the lower-cased column name", () => {
    const columns = [{ name: "AMOUNT", description: "" }];

    expect(
      columnProposals.applyDescriptionProposals(columns, [disagreeing], {
        amount: { candidate: 1 },
      }),
    ).toEqual([{ name: "AMOUNT", description: "Sum of totals" }]);
    expect(
      columnProposals.applyDescriptionProposals(columns, [disagreeing], {
        amount: { candidate: 0 },
      }),
    ).toEqual([{ name: "AMOUNT", description: "Order total" }]);
  });

  it("skips a choice that names no candidate of the proposal", () => {
    const columns = [{ name: "amount", description: "" }];

    expect(
      columnProposals.applyDescriptionProposals(columns, [disagreeing], {
        amount: { candidate: 2 },
      }),
    ).toEqual([{ name: "amount", description: "" }]);
  });

  it("keeps a description typed since the proposal arrived, and matches names ignoring case", () => {
    const applied = columnProposals.applyDescriptionProposals(
      [{ name: "GRAND_TOTAL", description: "Typed by hand" }],
      [single],
    );

    expect(applied).toEqual([
      { name: "GRAND_TOTAL", description: "Typed by hand" },
    ]);
  });

  it("skips a proposal with no candidate or no matching column, and leaves the input unchanged", () => {
    const columns = [{ name: "id", description: "" }];
    const applied = columnProposals.applyDescriptionProposals(columns, [
      { column: "id", candidates: [] },
      { ...single, column: "missing" },
    ]);

    expect(applied).toEqual([{ name: "id", description: "" }]);
    expect(columns).toEqual([{ name: "id", description: "" }]);
  });
});

describe("isColumnProposalsPayload", () => {
  const descriptions: columnProposals.DescriptionProposalsPayload = {
    kind: "descriptions",
    model: "/p/models/orders.sql",
    proposals: [
      {
        column: "grand_total",
        candidates: [
          {
            description: "Order total",
            sources: [{ uniqueId: "model.p.order_totals", column: "total" }],
          },
        ],
      },
    ],
  };

  it("accepts a descriptions payload, with or without a notice", () => {
    expect(columnProposals.isColumnProposalsPayload(descriptions)).toBe(true);
    expect(
      columnProposals.isColumnProposalsPayload({
        ...descriptions,
        proposals: [],
        notice: {
          message: "Upstream descriptions need strict static analysis.",
          type: "warning",
          actions: [
            { title: "Use strict analysis", action: "useStrictAnalysis" },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects a descriptions payload with a malformed source or candidate", () => {
    expect(
      columnProposals.isColumnProposalsPayload({
        ...descriptions,
        proposals: [
          {
            column: "grand_total",
            candidates: [
              { description: "Order total", sources: [{ uniqueId: "x" }] },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(
      columnProposals.isColumnProposalsPayload({
        ...descriptions,
        proposals: [{ column: "grand_total", candidates: [{}] }],
      }),
    ).toBe(false);
    expect(
      columnProposals.isColumnProposalsPayload({
        ...descriptions,
        kind: "docs",
      }),
    ).toBe(false);
  });
});
