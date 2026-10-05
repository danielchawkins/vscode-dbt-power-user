import { describe, expect, it } from "vitest";
import { CodeLens } from "vscode";
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
});
