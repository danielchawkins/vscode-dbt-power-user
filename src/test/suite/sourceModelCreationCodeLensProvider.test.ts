import { describe, expect, it } from "vitest";
import { CodeLens, Range } from "vscode";
import { SourceModelCreationCodeLensProvider } from "../../features/codegen/sourceModelCreationCodeLensProvider";

const token = {} as any;
const uri = { fsPath: "/p/models/sources.yml" };

function lensesFor(yaml: string): CodeLens[] {
  const document = { getText: () => yaml, uri } as any;
  return new SourceModelCreationCodeLensProvider().provideCodeLenses(
    document,
    token,
  ) as CodeLens[];
}

const argsOf = (lenses: CodeLens[]) =>
  lenses.map((lens) => lens.command?.arguments?.[0]);

describe("SourceModelCreationCodeLensProvider", () => {
  it("puts one Generate model lens on each named table", () => {
    const lenses = lensesFor(
      [
        "version: 2",
        "sources:",
        "  - name: raw",
        "    database: db",
        "    schema: s",
        "    tables:",
        "      - name: orders",
        "      - name: customers",
        "        identifier: cust_tbl",
      ].join("\n"),
    );

    expect(lenses.map((lens) => lens.command)).toEqual([
      {
        title: "Generate model",
        tooltip: "Generate model based on source configuration",
        command: "fusionPowerUser.createModelBasedonSourceConfig",
        arguments: [
          {
            currentDoc: uri,
            sourceName: "raw",
            database: "db",
            schema: "s",
            tableName: "orders",
            tableIdentifier: undefined,
          },
        ],
      },
      expect.objectContaining({
        arguments: [
          expect.objectContaining({
            tableName: "customers",
            tableIdentifier: "cust_tbl",
          }),
        ],
      }),
    ]);
    // Zero-based line, but the one-based column that `LineCounter.linePos` returns.
    expect(lenses.map((lens) => lens.range)).toEqual([
      new Range(6, 9, 6, 9),
      new Range(7, 9, 7, 9),
    ]);
  });

  it("reads source properties written after tables", () => {
    const lenses = lensesFor(
      [
        "sources:",
        "  - tables:",
        "      - name: orders",
        "    name: raw",
        "    schema: s",
      ].join("\n"),
    );

    expect(argsOf(lenses)).toEqual([
      expect.objectContaining({
        sourceName: "raw",
        database: undefined,
        schema: "s",
        tableName: "orders",
      }),
    ]);
  });

  it("does not carry database or schema into the next source", () => {
    const lenses = lensesFor(
      [
        "sources:",
        "  - name: a",
        "    database: db_a",
        "    schema: s_a",
        "    tables:",
        "      - name: t1",
        "  - name: b",
        "    tables:",
        "      - name: t2",
      ].join("\n"),
    );

    expect(argsOf(lenses)).toEqual([
      expect.objectContaining({
        sourceName: "a",
        database: "db_a",
        tableName: "t1",
      }),
      expect.objectContaining({
        sourceName: "b",
        database: undefined,
        schema: undefined,
        tableName: "t2",
      }),
    ]);
  });

  it("skips tables without a name and scalar table entries", () => {
    const lenses = lensesFor(
      [
        "sources:",
        "  - name: raw",
        "    tables:",
        "      - description: nameless",
        "      - orders",
        "      - name: kept",
      ].join("\n"),
    );

    expect(argsOf(lenses).map((a) => a.tableName)).toEqual(["kept"]);
  });

  it("carries an identifier from a nameless table into the next table", () => {
    const lenses = lensesFor(
      [
        "sources:",
        "  - name: raw",
        "    tables:",
        "      - identifier: orphan",
        "      - name: next",
      ].join("\n"),
    );

    expect(argsOf(lenses)).toEqual([
      expect.objectContaining({ tableName: "next", tableIdentifier: "orphan" }),
    ]);
  });

  it("ignores keys other than sources, and documents without sources", () => {
    expect(
      lensesFor(
        ["models:", "  - name: m", "    tables:", "      - name: t"].join("\n"),
      ),
    ).toEqual([]);
    expect(lensesFor("")).toEqual([]);
    expect(lensesFor("- just\n- a list")).toEqual([]);
  });

  it("reads every document in a multi-document file", () => {
    const lenses = lensesFor(
      [
        "sources:",
        "  - name: a",
        "    tables:",
        "      - name: t1",
        "---",
        "sources:",
        "  - name: b",
        "    tables:",
        "      - name: t2",
      ].join("\n"),
    );

    expect(argsOf(lenses).map((a) => [a.sourceName, a.tableName])).toEqual([
      ["a", "t1"],
      ["b", "t2"],
    ]);
  });

  it("returns a fresh list on each call", () => {
    const provider = new SourceModelCreationCodeLensProvider();
    const document = {
      getText: () => "sources:\n  - name: a\n    tables:\n      - name: t\n",
      uri,
    } as any;
    provider.provideCodeLenses(document, token);
    expect(provider.provideCodeLenses(document, token)).toHaveLength(1);
  });
});
