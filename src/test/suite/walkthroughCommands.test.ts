import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Uri, window } from "vscode";
import { WalkthroughCommands } from "../../commands/walkthroughCommands";
import {
  ProjectQuickPick,
  ProjectQuickPickItem,
} from "../../quickpick/projectQuickPick";

const projectUri = Uri.file("/path/to/project");
const pickedProject: ProjectQuickPickItem = {
  label: "test_project",
  description: projectUri.fsPath,
  uri: projectUri,
};

describe("WalkthroughCommands project resolution", () => {
  const mockDbtTerminal = {
    error: jest.fn(),
    debug: jest.fn(),
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createCommands(options: {
    storedProject?: ProjectQuickPickItem;
    pickerResult?: ProjectQuickPickItem;
    debugOutput?: string;
  }) {
    const mockProject = {
      debug: jest.fn(() =>
        Promise.resolve({
          fullOutput: options.debugOutput ?? "All checks passed",
        }),
      ),
      installDeps: jest.fn(() => Promise.resolve()),
    };
    const mockContainer = {
      getFromWorkspaceState: jest.fn(),
      setToWorkspaceState: jest.fn(),
      getProjects: jest.fn(() => Promise.resolve([mockProject])),
      findDBTProject: jest.fn(() => mockProject),
    };
    const mockPicker = {
      projectPicker: jest.fn(() => Promise.resolve(options.pickerResult)),
    };

    const commands = new WalkthroughCommands(
      mockContainer as never,
      mockPicker as unknown as ProjectQuickPick,
      mockDbtTerminal as never,
    );

    return { commands, mockContainer, mockPicker, mockProject };
  }

  it("validateProjects uses a provided project without opening the picker", async () => {
    const { commands, mockPicker, mockProject } = createCommands({});

    await commands.validateProjects(pickedProject, true);

    expect(mockPicker.projectPicker).not.toHaveBeenCalled();
    expect(mockProject.debug).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("validateProjects cancels silently when the picker is dismissed", async () => {
    jest.mocked(window.showErrorMessage).mockResolvedValue(undefined as never);
    const { commands, mockPicker, mockProject } = createCommands({
      pickerResult: undefined,
    });

    await commands.validateProjects(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockProject.debug).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("validateProjects falls back to the picker and persists the selection", async () => {
    const { commands, mockContainer, mockPicker, mockProject } = createCommands(
      {
        pickerResult: pickedProject,
      },
    );

    await commands.validateProjects(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockContainer.setToWorkspaceState).toHaveBeenCalledWith(
      "dbtPowerUser.projectSelected",
      pickedProject,
    );
    expect(mockProject.debug).toHaveBeenCalledTimes(1);
  });

  it("installDeps cancels silently when the picker is dismissed", async () => {
    jest.mocked(window.showErrorMessage).mockResolvedValue(undefined as never);
    const { commands, mockPicker, mockProject } = createCommands({
      pickerResult: undefined,
    });

    await commands.installDeps(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockProject.installDeps).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("installDeps runs after picker selection", async () => {
    const { commands, mockPicker, mockProject } = createCommands({
      pickerResult: pickedProject,
    });

    await commands.installDeps(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockProject.installDeps).toHaveBeenCalledTimes(1);
  });
});
