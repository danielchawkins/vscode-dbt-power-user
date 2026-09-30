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
import { ExtensionContextStore } from "../../extensionContext";
import { DbtPowerUserActionsCenter } from "../../features/projectPicker/actionsCenter";
import { CurrentProject } from "../../projects/currentProject";
import { DeclaredProject } from "../../projects/projectRegistry";

describe("DbtPowerUserActionsCenter project picker", () => {
  let context: Mocked<CurrentProject>;
  let store: Mocked<ExtensionContextStore>;
  let project: DeclaredProject;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      pickForCommand: vi.fn(),
    } as unknown as Mocked<CurrentProject>;
    store = {
      setToWorkspaceState: vi.fn(),
    } as unknown as Mocked<ExtensionContextStore>;
    project = {
      root: Uri.file("/project"),
      name: "project",
      folder: {
        uri: Uri.file("/workspace"),
        name: "workspace",
        index: 0,
      },
      contains: () => true,
      dispose: vi.fn(),
    };
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
