import {
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type Mocked,
  vi,
} from "vitest";
import { commands, Uri, window } from "vscode";
import type { ExtensionContextStore } from "../../extensionContext";
import { DbtPowerUserActionsCenter } from "../../features/projectPicker/actionsCenter";
import type { CurrentProject } from "../../projects/project/currentProject";
import type { Project } from "../../projects/project/project";

describe("DbtPowerUserActionsCenter project picker", () => {
  let context: Mocked<CurrentProject>;
  let store: Mocked<ExtensionContextStore>;
  let project: Project;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      pickForCommand: vi.fn(),
    } as unknown as Mocked<CurrentProject>;
    store = {
      setToWorkspaceState: vi.fn(),
    } as unknown as Mocked<ExtensionContextStore>;
    project = {
      declared: {
        root: Uri.file("/project"),
        name: "project",
      },
      root: Uri.file("/project"),
      getProjectName: () => "project",
    } as unknown as Project;
    new DbtPowerUserActionsCenter(context, store);
  });

  it("stores an explicit Current Project pick for validate and install", async () => {
    context.pickForCommand.mockResolvedValue(project);

    await pickProjectCommand()();

    expect(store.setToWorkspaceState).toHaveBeenCalledWith(
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

    expect(store.setToWorkspaceState).not.toHaveBeenCalled();
  });
});

function pickProjectCommand(): () => Promise<void> {
  const registration = (commands.registerCommand as Mock).mock.calls.find(
    ([command]) => command === "fusionPowerUser.pickProject",
  );
  return registration?.[1] as () => Promise<void>;
}
