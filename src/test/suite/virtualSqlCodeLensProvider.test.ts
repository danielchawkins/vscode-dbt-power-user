import { describe, expect, it, jest } from "@jest/globals";
import { CancellationToken, CodeLens, TextDocument, Uri } from "vscode";
import { VirtualSqlCodeLensProvider } from "../../features/sqlActions/virtualSqlCodeLensProvider";
import { QueryManifestService } from "../../projects/queryManifestService";

describe("VirtualSqlCodeLensProvider", () => {
  it.each([
    [undefined, "Project: Select a project"],
    [{ getProjectName: () => "analytics" }, "Project: analytics"],
  ])("renders the Current Project result", (project, title) => {
    const queryManifest = {
      getProject: jest.fn().mockReturnValue(project),
    } as unknown as QueryManifestService;
    const provider = new VirtualSqlCodeLensProvider(queryManifest);

    const lenses = provider.provideCodeLenses(
      {
        uri: {
          scheme: "untitled",
          fsPath: "Untitled-1",
          path: "Untitled-1",
        } as Uri,
        languageId: "jinja-sql",
      } as unknown as TextDocument,
      {} as CancellationToken,
    ) as CodeLens[];

    expect(lenses).toHaveLength(1);
    expect(lenses[0].command).toMatchObject({
      title,
      command: "fusionPowerUser.pickProject",
    });
  });
});
