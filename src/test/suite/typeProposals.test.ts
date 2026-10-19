import { describe, expect, it } from "vitest";
import type { AnsweredTypes, DocColumn } from "../../core/columns/typeProposals";
import { typeProposals } from "../../core/columns/typeProposals";

const answer = (
  columns: AnsweredTypes["columns"],
): AnsweredTypes => ({ source: "target", columns });

describe("typeProposals", () => {
  it("fills an empty YAML type with the relation's type", () => {
    const current: DocColumn[] = [{ name: "id" }, { name: "name", type: "" }];
    expect(
      typeProposals(
        current,
        answer([
          { column: "id", dtype: "INTEGER" },
          { column: "name", dtype: "VARCHAR" },
        ]),
      ),
    ).toEqual({
      proposals: [
        { column: "id", type: "INTEGER", change: "fill" },
        { column: "name", type: "VARCHAR", change: "fill" },
      ],
      notFound: [],
    });
  });

  it("adds a relation column that the YAML does not list, in the relation's spelling", () => {
    expect(
      typeProposals([], answer([{ column: "Amount", dtype: "DECIMAL" }])),
    ).toEqual({
      proposals: [{ column: "Amount", type: "DECIMAL", change: "add" }],
      notFound: [],
    });
  });

  it("overwrites a different YAML type, keeping the YAML spelling and the current type", () => {
    expect(
      typeProposals(
        [{ name: "ID", type: "VARCHAR" }],
        answer([{ column: "id", dtype: "INTEGER" }]),
      ),
    ).toEqual({
      proposals: [
        {
          column: "ID",
          type: "INTEGER",
          change: "overwrite",
          current: "VARCHAR",
        },
      ],
      notFound: [],
    });
  });

  it("reports YAML-only columns in YAML order and edits none of them", () => {
    expect(
      typeProposals(
        [{ name: "old_b" }, { name: "kept", type: "INTEGER" }, { name: "old_a" }],
        answer([{ column: "kept", dtype: "INTEGER" }]),
      ),
    ).toEqual({ proposals: [], notFound: ["old_b", "old_a"] });
  });

  it("matches names and compares types ignoring case", () => {
    expect(
      typeProposals(
        [{ name: "ID", type: "integer" }],
        answer([{ column: "id", dtype: "INTEGER" }]),
      ),
    ).toEqual({ proposals: [], notFound: [] });
  });

  it("skips an empty source type, so it neither fills nor adds nor overwrites", () => {
    expect(
      typeProposals(
        [{ name: "id", type: "INTEGER" }, { name: "name" }],
        answer([
          { column: "id", dtype: "" },
          { column: "name", dtype: "" },
          { column: "new", dtype: "" },
        ]),
      ),
    ).toEqual({ proposals: [], notFound: [] });
  });

  it("gives nothing for identical types", () => {
    expect(
      typeProposals(
        [{ name: "id", type: "INTEGER" }],
        answer([{ column: "id", dtype: "INTEGER" }]),
      ),
    ).toEqual({ proposals: [], notFound: [] });
  });

  it("follows the relation's order for proposals", () => {
    const result = typeProposals(
      [{ name: "b" }, { name: "a" }],
      answer([
        { column: "a", dtype: "INTEGER" },
        { column: "c", dtype: "TEXT" },
        { column: "b", dtype: "DATE" },
      ]),
    );
    expect(result.proposals.map(({ column }) => column)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
