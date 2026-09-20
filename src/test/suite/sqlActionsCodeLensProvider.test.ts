import { describe, expect, it } from "@jest/globals";
import { CodeLens } from "vscode";
import { SqlActionsCodeLensProvider } from "../../code_lens_provider/sqlActionsCodeLensProvider";

function makeDoc(fsPath: string): any {
  return { fileName: fsPath, uri: { fsPath } };
}

const token = {} as any;
const titlesOf = (lenses: any): (string | undefined)[] =>
  (lenses as CodeLens[]).map((l) => l.command?.title);

describe("SqlActionsCodeLensProvider", () => {
  it("provides local SQL actions", () => {
    const provider = new SqlActionsCodeLensProvider();
    const lenses = provider.provideCodeLenses(makeDoc("a.sql"), token);

    expect(titlesOf(lenses)).toEqual([
      "$(play) Execute Query",
      "$(book) Document",
    ]);
  });
});
