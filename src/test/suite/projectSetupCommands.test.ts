import { afterEach, describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import { ProjectSetupCommands } from "../../features/projectSetup/projectSetupCommands";
import {
  ProjectQuickPick,
  ProjectQuickPickItem,
} from "../../projects/projectQuickPick";

const projectUri = Uri.file("/path/to/project");
const pickedProject: ProjectQuickPickItem = {
  label: "test_project",
  description: projectUri.fsPath,
  uri: projectUri,
};

describe("ProjectSetupCommands project resolution", () => {
  const projectLog = {
    name: "Fusion Power User: test_project",
    error: vi.fn(),
  };
  const outputChannels = { logFor: vi.fn(() => projectLog) };

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createCommands(options: {
    storedProject?: ProjectQuickPickItem;
    pickerResult?: ProjectQuickPickItem;
    debugOutput?: string;
    installError?: Error;
  }) {
    const mockProject = {
      debug: vi.fn(() =>
        Promise.resolve({
          fullOutput: options.debugOutput ?? "All checks passed",
        }),
      ),
      installDeps: vi.fn(() =>
        options.installError
          ? Promise.reject(options.installError)
          : Promise.resolve(),
      ),
    };
    const mockStore = { setToWorkspaceState: vi.fn() };
    const mockProjects = {
      all: vi.fn(() => Promise.resolve([mockProject])),
      get: vi.fn(() => mockProject),
    };
    const mockPicker = {
      projectPicker: vi.fn(() => Promise.resolve(options.pickerResult)),
    };

    const commands = new ProjectSetupCommands(
      mockProjects as never,
      mockStore as never,
      mockPicker as unknown as ProjectQuickPick,
      outputChannels as never,
    );

    return { commands, mockStore, mockPicker, mockProject };
  }

  it("validateProjects uses a provided project without opening the picker", async () => {
    const { commands, mockPicker, mockProject } = createCommands({});

    await commands.validateProjects(pickedProject, true);

    expect(mockPicker.projectPicker).not.toHaveBeenCalled();
    expect(mockProject.debug).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("validateProjects cancels silently when the picker is dismissed", async () => {
    vi.mocked(window.showErrorMessage).mockResolvedValue(undefined);
    const { commands, mockPicker, mockProject } = createCommands({
      pickerResult: undefined,
    });

    await commands.validateProjects(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockProject.debug).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("validateProjects falls back to the picker and persists the selection", async () => {
    const { commands, mockStore, mockPicker, mockProject } = createCommands({
      pickerResult: pickedProject,
    });

    await commands.validateProjects(undefined, true);

    expect(mockPicker.projectPicker).toHaveBeenCalledTimes(1);
    expect(mockStore.setToWorkspaceState).toHaveBeenCalledWith(
      "fusionPowerUser.projectSelected",
      pickedProject,
    );
    expect(mockProject.debug).toHaveBeenCalledTimes(1);
  });

  it("installDeps cancels silently when the picker is dismissed", async () => {
    vi.mocked(window.showErrorMessage).mockResolvedValue(undefined);
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

  it("validateProjects names the project's channel when dbt debug fails", async () => {
    const { commands } = createCommands({ debugOutput: "ERROR: no profile" });

    await expect(
      commands.validateProjects(pickedProject, true),
    ).rejects.toThrow("no profile");

    expect(outputChannels.logFor).toHaveBeenCalledWith(projectUri);
    expect(projectLog.error).toHaveBeenCalledWith(
      "validateProjectError",
      "Error when validating test_project",
      expect.any(Error),
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Error running dbt debug for project test_project. See the "Fusion Power User: test_project" ' +
        "output for details.",
    );
  });

  it("installDeps names the project's channel when dbt deps fails", async () => {
    const { commands } = createCommands({
      installError: new Error("dbt deps exited with code 1"),
    });

    await expect(commands.installDeps(pickedProject, true)).rejects.toThrow(
      "code 1",
    );

    expect(projectLog.error).toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Error installing dbt dependencies for project test_project. See the dbt task terminal or the " +
        '"Fusion Power User: test_project" output for details.',
    );
  });
});
