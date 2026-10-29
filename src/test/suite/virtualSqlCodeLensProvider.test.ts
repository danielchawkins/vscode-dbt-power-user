import { describe, expect, it } from "vitest";
import type { CancellationToken, CodeLens, TextDocument, Uri } from "vscode";
import { VirtualSqlCodeLensProvider } from "../../features/sqlActions/virtualSqlCodeLensProvider";
import type { CurrentProject } from "../../projects/project/currentProject";

describe("VirtualSqlCodeLensProvider", () => {
  it.each([
    [undefined, "Project: Select a project"],
    [{ getProjectName: () => "analytics" }, "Project: analytics"],
  ])("renders the Current Project result", (project, title) => {
    const currentProject = {
      current: project,
    } as unknown as CurrentProject;
    const provider = new VirtualSqlCodeLensProvider(currentProject);

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
