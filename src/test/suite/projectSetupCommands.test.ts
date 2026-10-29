import { afterEach, describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import { resolveProjectSnapshot } from "../../core/snapshot";
import { ProjectSetupCommands } from "../../features/projectSetup/projectSetupCommands";
import { FusionCli } from "../../fusion/fusionCli";
import { noSettings } from "../arbitraries/projectSnapshot";
import { RecordingTasks } from "../recordingTasks";

const projectUri = Uri.file("/path/to/project");

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

describe("ProjectSetupCommands", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function createCommands(options: {
    debugOutput?: string;
    depsExitCode?: number;
  }) {
    const debugRuns: { command: string; args: string[]; cwd: string }[] = [];
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
    const cli = new FusionCli({
      executable: { path: "/bin/dbt", env: {} },
      snapshot: () => snapshot,
      processes: {
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
      terminal: {
        debug: noop,
        info: noop,
        output: noop,
        warn: noop,
        error: noop,
        dispose: noop,
      },
    });
    const project = {
      root: projectUri,
      getProjectName: () => "test_project",
      commands: {
        debug: () => cli.run({ kind: "debug" }),
        installDeps: () => tasks.installDeps(),
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

    const commands = new ProjectSetupCommands({
      outputChannels: outputChannels as never,
    });

    return {
      commands,
      project,
      logged,
      logChannels,
      /** The `dbt debug` runs (built argv and cwd) and the queued task commands, each list in order. */
      ran: () => ({ debug: debugRuns, tasks: tasks.commands }),
    };
  }

  it("validateProjects runs dbt debug on the project it is given", async () => {
    const { commands, project, ran } = createCommands({});

    await commands.validateProjects(project, true);

    expect(ran()).toEqual({ debug: [debugRun], tasks: [] });
    expect(shownErrors()).toEqual([]);
  });

  it("validateProjects does nothing without a project", async () => {
    const { commands, ran } = createCommands({});

    await commands.validateProjects(undefined, true);

    expect(ran()).toEqual({ debug: [], tasks: [] });
    expect(shownErrors()).toEqual([]);
  });

  it("installDeps does nothing without a project", async () => {
    const { commands, ran } = createCommands({});

    await commands.installDeps(undefined, true);

    expect(ran()).toEqual({ debug: [], tasks: [] });
    expect(shownErrors()).toEqual([]);
  });

  it("installDeps queues dbt deps for the project it is given", async () => {
    const { commands, project, ran } = createCommands({});

    await commands.installDeps(project, true);

    expect(ran()).toEqual({ debug: [], tasks: [{ kind: "deps" }] });
  });

  it("validateProjects names the project's channel when dbt debug fails", async () => {
    const { commands, project, logged, logChannels } = createCommands({
      debugOutput: "ERROR: no profile",
    });

    await expect(
      commands.validateProjects(project as never, true),
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
    const { commands, project, logged } = createCommands({ depsExitCode: 1 });

    await expect(commands.installDeps(project as never, true)).rejects.toThrow(
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
