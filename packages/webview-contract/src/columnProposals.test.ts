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
