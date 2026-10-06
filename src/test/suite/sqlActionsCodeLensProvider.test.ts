import { describe, expect, it } from "vitest";
import { CodeLens, Range } from "vscode";
import { SqlActionsCodeLensProvider } from "../../features/sqlActions/sqlActionsCodeLensProvider";

function makeDoc(fsPath: string): any {
  return { fileName: fsPath, uri: { fsPath } };
}

const token = {} as any;
const titlesOf = (lenses: any): (string | undefined)[] =>
  (lenses as CodeLens[]).map((l) => l.command?.title);

describe("SqlActionsCodeLensProvider", () => {
  it("provides no lenses on SQL files", () => {
    const provider = new SqlActionsCodeLensProvider();
    const lenses = provider.provideCodeLenses(makeDoc("a.sql"), token);

    expect(titlesOf(lenses)).toEqual([]);
  });

  it("places each YAML model lens on the zero-based column of its name", () => {
    const provider = new SqlActionsCodeLensProvider();
    const text = ["models:", "  - name: orders"].join("\n");
    const lenses = provider.provideCodeLenses(
      { ...makeDoc("schema.yml"), getText: () => text },
      token,
    ) as CodeLens[];

    expect(lenses.map((lens) => lens.command?.title)).toEqual([
      "$(play) Run",
      "$(beaker) Test",
    ]);
    expect(lenses.map((lens) => lens.range)).toEqual([
      new Range(1, 4, 1, 4),
      new Range(1, 4, 1, 4),
    ]);
  });
});
