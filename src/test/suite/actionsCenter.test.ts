import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { commands, Uri, window } from "vscode";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import { ProjectContext } from "../../projects/projectContext";
import { DeclaredProject } from "../../projects/projectRegistry";
import { DbtPowerUserActionsCenter } from "../../quickpick";

describe("DbtPowerUserActionsCenter project picker", () => {
  let context: jest.Mocked<ProjectContext>;
  let container: jest.Mocked<DBTProjectContainer>;
  let project: DeclaredProject;

  beforeEach(() => {
    jest.clearAllMocks();
    context = {
      pickForCommand: jest.fn(),
    } as unknown as jest.Mocked<ProjectContext>;
    container = {
      setToWorkspaceState: jest.fn(),
    } as unknown as jest.Mocked<DBTProjectContainer>;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: {
        uri: Uri.file("/workspace"),
        name: "workspace",
        index: 0,
      },
      contains: () => true,
      dispose: jest.fn(),
    };
    new DbtPowerUserActionsCenter(context, container);
  });

  it("stores an explicit Project Context pick for validate and install", async () => {
    context.pickForCommand.mockResolvedValue(project);

    await pickProjectCommand()();

    expect(container.setToWorkspaceState).toHaveBeenCalledWith(
      "fusionPowerUser.projectSelected",
      {
        label: "project",
        description: "/project",
        uri: project.root,
      },
    );
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "You have successfully selected project.",
    );
  });

  it("does nothing when the picker is cancelled", async () => {
    context.pickForCommand.mockResolvedValue(undefined);

    await pickProjectCommand()();

    expect(container.setToWorkspaceState).not.toHaveBeenCalled();
  });
});

function pickProjectCommand(): () => Promise<void> {
  const registration = (commands.registerCommand as jest.Mock).mock.calls.find(
    ([command]) => command === "fusionPowerUser.pickProject",
  );
  return registration?.[1] as () => Promise<void>;
}
