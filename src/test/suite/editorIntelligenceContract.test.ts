import { DBTTerminal } from "@altimateai/dbt-integration";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { CancellationToken, Position, Range, TextDocument, Uri } from "vscode";
import { ModelAutocompletionProvider } from "../../autocompletion_provider/modelAutocompletionProvider";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import { ModelHoverProvider } from "../../hover_provider/modelHoverProvider";
import { esmDirname } from "../esmDirname";

const srcRoot = path.resolve(esmDirname(import.meta.url), "../../");

describe("editor intelligence project resolution", () => {
  let container: jest.Mocked<DBTProjectContainer>;
  let terminal: jest.Mocked<DBTTerminal>;

  beforeEach(() => {
    container = {
      onManifestChanged: jest.fn(() => ({ dispose: jest.fn() })),
      findDBTProject: jest.fn(),
      getFromWorkspaceState: jest.fn(),
    } as unknown as jest.Mocked<DBTProjectContainer>;
    terminal = {
      debug: jest.fn(),
    } as unknown as jest.Mocked<DBTTerminal>;
  });

  it("returns nothing for resources outside every Declared Project", async () => {
    const uri = Uri.file("/outside/model.sql");
    const hover = new ModelHoverProvider(container, terminal);
    const completion = new ModelAutocompletionProvider(container);
    const getCompletionItems = (
      completion as unknown as { getAutoCompleteItems(uri: Uri): unknown }
    ).getAutoCompleteItems.bind(completion);
    const range = {} as Range;
    const hoverResult = hover.provideHover(
      {
        uri,
        getText: jest.fn().mockReturnValue("ref"),
        getWordRangeAtPosition: jest.fn().mockReturnValue(range),
      } as unknown as TextDocument,
      {} as Position,
      {} as CancellationToken,
    );

    await expect(hoverResult).resolves.toBeUndefined();
    expect(getCompletionItems(uri)).toBeUndefined();
    expect(container.findDBTProject).toHaveBeenCalledTimes(2);
    expect(container.getFromWorkspaceState).not.toHaveBeenCalled();
  });

  it("limits projectSelected references to explicit user-invoked paths", () => {
    const callers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("fusionPowerUser.projectSelected"),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(callers).toEqual([
      "commands/index.ts",
      "commands/walkthroughCommands.ts",
      "quickpick/index.ts",
    ]);
  });

  it("routes SQL commands through Project Context", () => {
    const directCallers = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("dbtProjectContainer.executeSQL("),
      )
      .map((file) => path.relative(srcRoot, file))
      .sort();

    expect(directCallers).toEqual(["commands/runModel.ts"]);
  });
});

function sourceFiles(root = srcRoot): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : sourceFiles(file);
    }
    return entry.name.endsWith(".ts") ? [file] : [];
  });
}
