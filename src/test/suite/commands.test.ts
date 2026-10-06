import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { commands, env, Uri, window, workspace } from "vscode";
import { VSCodeCommands } from "../../features/commands";

vi.mock("../../projects/previewUri", () => ({
  activeModelUri: (uri: unknown) => uri,
  previewUriFor: () => ({ toString: () => "preview:/a.sql" }),
}));

type Handler = (...args: any[]) => Promise<unknown>;

const build = (over: { projects?: unknown; runTest?: unknown } = {}) => {
  const runModel = {
    runModelOnActiveWindow: vi.fn(),
    runTestsOnActiveWindow: vi.fn(),
    compileModelOnActiveWindow: vi.fn(),
    buildModelOnActiveWindow: vi.fn(),
    runModelOnNodeTreeItem: vi.fn(() => vi.fn()),
    executeSQL: vi.fn(),
  };
  const runTest = {
    runSingularTestOnActiveWindowIfApplicable: vi.fn(() => false),
    ...(over.runTest as object),
  };
  const runHistoryService = { clear: vi.fn() };
  const deferBar = { updateStatusBar: vi.fn() };
  const projectSetupCommands = {
    validateProjects: vi.fn(),
    installDeps: vi.fn(),
  };
  const extensionContext = {
    getFromWorkspaceState: vi.fn(() => "picked"),
  };
  const log = { error: vi.fn(), debug: vi.fn() };
  new VSCodeCommands(
    (over.projects ?? { get: () => undefined, all: () => [] }) as never,
    extensionContext as never,
    runModel as never,
    runTest as never,
    projectSetupCommands as never,
    log as never,
    {} as never,
    runHistoryService as never,
    { cancel: vi.fn(), clearResults: vi.fn() } as never,
    { toggle: vi.fn() } as never,
    deferBar as never,
    { whenSettled: async () => undefined },
  );
  const handler = (id: string): Handler => {
    const call = (commands.registerCommand as Mock).mock.calls.find(
      ([command]) => command === id,
    );
    expect(call, `${id} is registered`).toBeDefined();
    return call![1] as Handler;
  };
  return {
    handler,
    runModel,
    runTest,
    runHistoryService,
    deferBar,
    projectSetupCommands,
    extensionContext,
    log,
  };
};

describe("VSCodeCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).activeTextEditor = undefined;
  });

  it("routes a singular test file away from the model run", async () => {
    const { handler, runModel, runTest } = build();
    await handler("fusionPowerUser.runCurrentModel")();
    expect(runModel.runModelOnActiveWindow).toHaveBeenCalledTimes(1);

    runTest.runSingularTestOnActiveWindowIfApplicable.mockReturnValue(true);
    await handler("fusionPowerUser.runCurrentModel")();
    await handler("fusionPowerUser.testCurrentModel")();
    expect(runModel.runModelOnActiveWindow).toHaveBeenCalledTimes(1);
    expect(runModel.runTestsOnActiveWindow).not.toHaveBeenCalled();
  });

  it("clears run history only after confirmation", async () => {
    const { handler, runHistoryService } = build();
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await handler("fusionPowerUser.clearRunHistory")();
    expect(runHistoryService.clear).not.toHaveBeenCalled();

    (window.showWarningMessage as Mock).mockResolvedValueOnce("Clear");
    await handler("fusionPowerUser.clearRunHistory")();
    expect(runHistoryService.clear).toHaveBeenCalledTimes(1);
  });

  it("asks for an active SQL file before profiling CTEs", async () => {
    const { handler } = build();
    await handler("fusionPowerUser.profileCtes")();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "No active SQL file to profile",
      "Show output",
    );
  });

  it("reports no CTEs when the server lenses carry none", async () => {
    const { handler } = build();
    (commands.executeCommand as Mock).mockResolvedValueOnce([]);
    await handler("fusionPowerUser.profileCtes")(Uri.file("/p/a.sql"));
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("No CTEs found"),
    );
  });

  it("runs YAML lens commands on the project that owns the file", async () => {
    const runModel = vi.fn();
    const runModelTest = vi.fn();
    const { handler } = build({
      projects: { get: () => ({ runModel, runModelTest }) },
    });
    await handler("fusionPowerUser.yamlRunModel")(Uri.file("/p/s.yml"), "a");
    await handler("fusionPowerUser.yamlTestModel")(Uri.file("/p/s.yml"), "a");
    expect(runModel).toHaveBeenCalledWith({
      plusOperatorLeft: "",
      modelName: "a",
      plusOperatorRight: "",
    });
    expect(runModelTest).toHaveBeenCalledWith("a");
  });

  it("ignores YAML lens commands outside a project", async () => {
    const { handler } = build();
    await expect(
      handler("fusionPowerUser.yamlRunModel")(Uri.file("/x/s.yml"), "a"),
    ).resolves.toBeUndefined();
  });

  it("builds and cleans the project of the active file", async () => {
    const buildProject = vi.fn();
    const clean = vi.fn();
    const { handler } = build({
      projects: {
        get: () => ({ buildProject, clean, getProjectName: () => "p" }),
      },
    });
    await handler("fusionPowerUser.buildCurrentProject")();
    expect(buildProject).not.toHaveBeenCalled();

    (window as any).activeTextEditor = {
      document: { uri: Uri.file("/p/models/a.sql") },
    };
    await handler("fusionPowerUser.buildCurrentProject")();
    await handler("fusionPowerUser.cleanCurrentProject")();
    expect(buildProject).toHaveBeenCalledTimes(1);
    expect(clean).toHaveBeenCalledTimes(1);
  });

  it("does nothing for the active file outside a project", async () => {
    const { handler, log } = build();
    (window as any).activeTextEditor = {
      document: { uri: Uri.file("/x/a.sql") },
    };
    await handler("fusionPowerUser.buildCurrentProject")();
    expect(log.debug).toHaveBeenCalledWith(
      "buildCurrentProject",
      expect.stringContaining("unable to find dbtproject"),
    );
  });

  it("validates and installs for the project picked in workspace state", async () => {
    const { handler, projectSetupCommands, extensionContext } = build();
    await handler("fusionPowerUser.validateProject")();
    await handler("fusionPowerUser.installDeps")();
    expect(extensionContext.getFromWorkspaceState).toHaveBeenCalledWith(
      "fusionPowerUser.projectSelected",
    );
    expect(projectSetupCommands.validateProjects).toHaveBeenCalledWith(
      "picked",
    );
    expect(projectSetupCommands.installDeps).toHaveBeenCalledWith("picked");
  });

  it("refreshes the defer status bar", async () => {
    const { handler, deferBar } = build();
    await handler("fusionPowerUser.applyDeferConfig")();
    expect(deferBar.updateStatusBar).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "Applied defer configuration",
    );
  });

  it("copies a model name to the clipboard", async () => {
    const writeText = vi.fn();
    (env as any).clipboard = { writeText };
    const { handler } = build();
    await handler("fusionPowerUser.copyModelName")({ label: "orders" });
    expect(writeText).toHaveBeenCalledWith("orders");
  });

  describe("compiled preview", () => {
    it("opens the preview beside the model without taking focus", async () => {
      const { handler } = build();
      (window as any).activeTextEditor = {
        document: { uri: Uri.file("/p/models/a.sql") },
      };
      (window as any).visibleTextEditors = [];
      (window as any).showTextDocument = vi.fn();
      (workspace.openTextDocument as Mock).mockResolvedValue({ doc: 1 });
      (window as any).showTextDocument = vi.fn();
      await handler("fusionPowerUser.showCompiledSQL")();
      expect(window.showTextDocument).toHaveBeenCalledWith(
        { doc: 1 },
        expect.objectContaining({ preserveFocus: true, preview: false }),
      );
    });

    it("does nothing without an active editor", async () => {
      const { handler } = build();
      await handler("fusionPowerUser.showCompiledSQL")();
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });
  });
});
