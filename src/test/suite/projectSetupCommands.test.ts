import { afterEach, describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import { resolveProjectSnapshot } from "../../core/project";
import { ProjectSetupCommands } from "../../features/projectSetup/projectSetupCommands";
import { FusionCli } from "../../fusion/fusionCli";
import {
  ProjectQuickPick,
  ProjectQuickPickItem,
} from "../../projects/projectQuickPick";
import { noSettings } from "../arbitraries/projectSnapshot";
import { RecordingTasks } from "../recordingTasks";

const projectUri = Uri.file("/path/to/project");
const pickedProject: ProjectQuickPickItem = {
  label: "test_project",
  description: projectUri.fsPath,
  uri: projectUri,
};

const snapshot = resolveProjectSnapshot({
  root: projectUri.fsPath,
  folder: "/path/to",
  firstWorkspaceFolder: "/path/to",
  userHome: "/home/u",
  environment: {},
  lspCompiledOutputOverride: undefined,
  settings: noSettings,
  projectFile: { kind: "parsed", text: "", config: { name: "test_project" } },
});

const debugRun = {
  command: "/bin/dbt",
  args: ["debug", "--project-dir", projectUri.fsPath],
  cwd: projectUri.fsPath,
};

const shownErrors = () =>
  vi.mocked(window.showErrorMessage).mock.calls.map(([message]) => message);

describe("ProjectSetupCommands project resolution", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function createCommands(options: {
    pickerResult?: ProjectQuickPickItem;
    debugOutput?: string;
    depsExitCode?: number;
  }) {
    const debugRuns: { command: string; args: string[]; cwd: string }[] = [];
    const requested: Uri[] = [];
    const picked: ProjectQuickPickItem[] = [];
    const pickerOpened: boolean[] = [];
    const logged: unknown[][] = [];
    const logChannels: Uri[] = [];
    const tasks = new RecordingTasks({
      stdout: "",
      stderr: "",
      fullOutput: "",
      exitCode: options.depsExitCode ?? 0,
    });
    const noop = () => undefined;
    // The real FusionCli builds the argv; only the process it would spawn is recorded.
    const cli = new FusionCli(
      { path: "/bin/dbt", env: {} },
      () => snapshot,
      {
        createCommandProcessExecution: (call: {
          command: string;
          args?: string[];
          cwd?: string;
        }) => {
          debugRuns.push({
            command: call.command,
            args: call.args ?? [],
            cwd: call.cwd ?? "",
          });
          return {
            complete: () =>
              Promise.resolve({
                stdout: "",
                stderr: "",
                fullOutput: options.debugOutput ?? "All checks passed",
                exitCode: 0,
              }),
          };
        },
      } as never,
      {
        debug: noop,
        info: noop,
        output: noop,
        warn: noop,
        error: noop,
        dispose: noop,
      },
    );
    const mockProject = {
      debug: () => cli.run({ kind: "debug" }),
      installDeps: () => tasks.installDeps(),
    };
    const mockStore = {
      setToWorkspaceState: (_key: string, value: ProjectQuickPickItem) => {
        picked.push(value);
      },
    };
    const mockProjects = {
      all: () => Promise.resolve([mockProject]),
      get: (uri: Uri) => {
        requested.push(uri);
        return mockProject;
      },
    };
    const mockPicker = {
      projectPicker: () => {
        pickerOpened.push(true);
        return Promise.resolve(options.pickerResult);
      },
    };
    const outputChannels = {
      logFor: (uri: Uri) => {
        logChannels.push(uri);
        return {
          name: "Fusion Power User: test_project",
          error: (...args: unknown[]) => logged.push(args),
        };
      },
    };

    const commands = new ProjectSetupCommands(
      mockProjects as never,
      mockStore as never,
      mockPicker as unknown as ProjectQuickPick,
      outputChannels as never,
    );

    return {
      commands,
      picked,
      pickerOpened,
      logged,
      requested,
      logChannels,
      /** The `dbt debug` runs (built argv and cwd) and the queued task commands, each list in order. */
      ran: () => ({ debug: debugRuns, tasks: tasks.commands }),
    };
  }

  it("validateProjects uses a provided project without opening the picker", async () => {
    const { commands, ran, pickerOpened, requested } = createCommands({});

    await commands.validateProjects(pickedProject, true);

    expect(ran()).toEqual({ debug: [debugRun], tasks: [] });
    expect(requested).toEqual([projectUri]);
    expect(pickerOpened).toEqual([]);
    expect(shownErrors()).toEqual([]);
  });

  it("validateProjects cancels silently when the picker is dismissed", async () => {
    vi.mocked(window.showErrorMessage).mockResolvedValue(undefined);
    const { commands, ran, pickerOpened } = createCommands({
      pickerResult: undefined,
    });

    await commands.validateProjects(undefined, true);

    expect(pickerOpened).toEqual([true]);
    expect(ran()).toEqual({ debug: [], tasks: [] });
    expect(shownErrors()).toEqual([]);
  });

  it("validateProjects falls back to the picker and persists the selection", async () => {
    const { commands, ran, picked, pickerOpened, requested } = createCommands({
      pickerResult: pickedProject,
    });

    await commands.validateProjects(undefined, true);

    expect(picked).toEqual([pickedProject]);
    expect(pickerOpened).toEqual([true]);
    expect(requested).toEqual([projectUri]);
    expect(ran()).toEqual({ debug: [debugRun], tasks: [] });
  });

  it("installDeps cancels silently when the picker is dismissed", async () => {
    vi.mocked(window.showErrorMessage).mockResolvedValue(undefined);
    const { commands, ran, pickerOpened } = createCommands({
      pickerResult: undefined,
    });

    await commands.installDeps(undefined, true);

    expect(pickerOpened).toEqual([true]);
    expect(ran()).toEqual({ debug: [], tasks: [] });
    expect(shownErrors()).toEqual([]);
  });

  it("installDeps runs after picker selection", async () => {
    const { commands, ran, pickerOpened } = createCommands({
      pickerResult: pickedProject,
    });

    await commands.installDeps(undefined, true);

    expect(pickerOpened).toEqual([true]);
    expect(ran()).toEqual({ debug: [], tasks: [{ kind: "deps" }] });
  });

  it("validateProjects names the project's channel when dbt debug fails", async () => {
    const { commands, logged, logChannels } = createCommands({
      debugOutput: "ERROR: no profile",
    });

    await expect(
      commands.validateProjects(pickedProject, true),
    ).rejects.toThrow("no profile");

    expect(logChannels).toEqual([projectUri]);
    expect(logged).toEqual([
      [
        "validateProjectError",
        "Error when validating test_project",
        expect.any(Error),
      ],
    ]);
    expect(shownErrors()).toEqual([
      expect.stringContaining("test_project: Error running dbt debug"),
    ]);
    expect(vi.mocked(window.showErrorMessage).mock.calls[0]?.slice(1)).toEqual([
      "Show output",
    ]);
  });

  it("installDeps names the project's channel when dbt deps fails", async () => {
    const { commands, logged } = createCommands({ depsExitCode: 1 });

    await expect(commands.installDeps(pickedProject, true)).rejects.toThrow(
      "code 1",
    );

    expect(logged).toHaveLength(1);
    expect(shownErrors()).toEqual([
      expect.stringContaining(
        "test_project: Error installing dbt dependencies",
      ),
    ]);
    expect(vi.mocked(window.showErrorMessage).mock.calls[0]?.slice(1)).toEqual([
      "Show output",
    ]);
  });
});
