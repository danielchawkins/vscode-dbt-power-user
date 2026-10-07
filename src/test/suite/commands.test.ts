import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { commands, env, Uri, window, workspace } from "vscode";
import { VSCodeCommands } from "../../features/commands";

vi.mock("../../projects/previewUri", () => ({
  activeModelUri: (uri: unknown) => uri,
  previewUriFor: () => ({ toString: () => "preview:/a.sql" }),
}));

type Handler = (...args: any[]) => Promise<unknown>;

const build = (over: { projects?: unknown; runTest?: unknown } = {}) => {
  /** What the collaborators were asked to do, in order. */
  const calls: unknown[][] = [];
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result;
    };
  const state = { singularTest: false };
  const runModel = {
    runModelOnActiveWindow: record("runModelOnActiveWindow"),
    runTestsOnActiveWindow: record("runTestsOnActiveWindow"),
    compileModelOnActiveWindow: record("compileModelOnActiveWindow"),
    buildModelOnActiveWindow: record("buildModelOnActiveWindow"),
    runModelOnNodeTreeItem: () => record("runModelOnNodeTreeItem"),
    executeSQL: record("executeSQL"),
  };
  const runTest = {
    runSingularTestOnActiveWindowIfApplicable: () => state.singularTest,
    ...(over.runTest as object),
  };
  const runHistoryService = { clear: record("clearRunHistory") };
  const deferBar = { updateStatusBar: record("updateStatusBar") };
  const projectSetupCommands = {
    validateProjects: record("validateProjects"),
    installDeps: record("installDeps"),
  };
  const extensionContext = {
    getFromWorkspaceState: (key: string) => (calls.push([key]), "picked"),
  };
  const log = { error: record("error"), debug: record("debug") };
  new VSCodeCommands({
    projects: (over.projects ?? {
      get: () => undefined,
      all: () => [],
    }) as never,
    extensionContext: extensionContext as never,
    runModel: runModel as never,
    runTest: runTest as never,
    projectSetupCommands: projectSetupCommands as never,
    log: log as never,
    diagnosticsOutputChannel: {} as never,
    runHistoryService: runHistoryService as never,
    cteProfilerService: { cancel: vi.fn(), clearResults: vi.fn() } as never,
    cteProfilerDecorationProvider: { toggle: vi.fn() } as never,
    deferToProductionStatusBar: deferBar as never,
    startupGate: { whenSettled: async () => undefined },
  });
  const handler = (id: string): Handler => {
    const call = (commands.registerCommand as Mock).mock.calls.find(
      ([command]) => command === id,
    );
    expect(call, `${id} is registered`).toBeDefined();
    return call![1] as Handler;
  };
  return { handler, calls, state };
};

const lastCall = (mock: Mock) => mock.mock.calls.at(-1);

describe("VSCodeCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).activeTextEditor = undefined;
  });

  it("routes a singular test file away from the model run", async () => {
    const { handler, calls, state } = build();
    await handler("fusionPowerUser.runCurrentModel")();
    expect(calls).toEqual([["runModelOnActiveWindow"]]);

    state.singularTest = true;
    await handler("fusionPowerUser.runCurrentModel")();
    await handler("fusionPowerUser.testCurrentModel")();
    expect(calls).toEqual([["runModelOnActiveWindow"]]);
  });

  it("clears run history only after confirmation", async () => {
    const { handler, calls } = build();
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await handler("fusionPowerUser.clearRunHistory")();
    expect(calls).toEqual([]);

    (window.showWarningMessage as Mock).mockResolvedValueOnce("Clear");
    await handler("fusionPowerUser.clearRunHistory")();
    expect(calls).toEqual([["clearRunHistory"]]);
  });

  it("asks for an active SQL file before profiling CTEs", async () => {
    const { handler } = build();
    await handler("fusionPowerUser.profileCtes")();
    expect((window.showErrorMessage as Mock).mock.calls).toEqual([
      ["No active SQL file to profile", "Show output"],
    ]);
  });

  it("reports no CTEs when the server lenses carry none", async () => {
    const { handler } = build();
    (commands.executeCommand as Mock).mockResolvedValueOnce([]);
    await handler("fusionPowerUser.profileCtes")(Uri.file("/p/a.sql"));
    expect((window.showInformationMessage as Mock).mock.calls).toEqual([
      [expect.stringContaining("No CTEs found")],
    ]);
  });

  it("runs YAML lens commands on the project that owns the file", async () => {
    const ran: unknown[][] = [];
    const { handler } = build({
      projects: {
        get: () => ({
          runModel: (params: unknown) => ran.push(["runModel", params]),
          runModelTest: (name: string) => ran.push(["runModelTest", name]),
        }),
      },
    });
    await handler("fusionPowerUser.yamlRunModel")(Uri.file("/p/s.yml"), "a");
    await handler("fusionPowerUser.yamlTestModel")(Uri.file("/p/s.yml"), "a");
    expect(ran).toEqual([
      [
        "runModel",
        { plusOperatorLeft: "", modelName: "a", plusOperatorRight: "" },
      ],
      ["runModelTest", "a"],
    ]);
  });

  it("ignores YAML lens commands outside a project", async () => {
    const { handler } = build();
    await expect(
      handler("fusionPowerUser.yamlRunModel")(Uri.file("/x/s.yml"), "a"),
    ).resolves.toBeUndefined();
  });

  it("does not turn a failed YAML lens run into a command error", async () => {
    const runModel = vi.fn().mockRejectedValue(new Error("boom"));
    const { handler } = build({ projects: { get: () => ({ runModel }) } });
    await expect(
      handler("fusionPowerUser.yamlRunModel")(Uri.file("/p/s.yml"), "a"),
    ).resolves.toBeUndefined();
  });

  it("logs a CTE that cannot be run", async () => {
    const { handler, calls } = build({ projects: { get: () => undefined } });
    await handler("fusionPowerUser.runCteWithDependencies")({
      uri: Uri.file("/p/a.sql"),
      cte: { name: "c", compiledPath: "/does/not/exist.sql" },
    });
    expect(calls).toEqual([
      ["error", "CteExecution", "Unable to execute CTE", expect.anything()],
    ]);
  });

  it("builds and cleans the project of the active file", async () => {
    const ran: string[] = [];
    const { handler } = build({
      projects: {
        get: () => ({
          buildProject: () => ran.push("buildProject"),
          clean: () => ran.push("clean"),
          getProjectName: () => "p",
        }),
      },
    });
    await handler("fusionPowerUser.buildCurrentProject")();
    expect(ran).toEqual([]);

    (window as any).activeTextEditor = {
      document: { uri: Uri.file("/p/models/a.sql") },
    };
    await handler("fusionPowerUser.buildCurrentProject")();
    await handler("fusionPowerUser.cleanCurrentProject")();
    expect(ran).toEqual(["buildProject", "clean"]);
  });

  it("does nothing for the active file outside a project", async () => {
    const { handler, calls } = build();
    (window as any).activeTextEditor = {
      document: { uri: Uri.file("/x/a.sql") },
    };
    await handler("fusionPowerUser.buildCurrentProject")();
    expect(calls).toEqual([
      [
        "debug",
        "buildCurrentProject",
        expect.stringContaining("unable to find dbtproject"),
      ],
    ]);
  });

  it("validates and installs for the project picked in workspace state", async () => {
    const { handler, calls } = build();
    await handler("fusionPowerUser.validateProject")();
    await handler("fusionPowerUser.installDeps")();
    expect(calls).toEqual([
      ["fusionPowerUser.projectSelected"],
      ["validateProjects", "picked"],
      ["fusionPowerUser.projectSelected"],
      ["installDeps", "picked"],
    ]);
  });

  it("refreshes the defer status bar", async () => {
    const { handler, calls } = build();
    await handler("fusionPowerUser.applyDeferConfig")();
    expect(calls).toEqual([["updateStatusBar"]]);
    expect((window.showInformationMessage as Mock).mock.calls).toEqual([
      ["Applied defer configuration"],
    ]);
  });

  it("copies a model name to the clipboard", async () => {
    const copied: string[] = [];
    (env as any).clipboard = { writeText: (text: string) => copied.push(text) };
    const { handler } = build();
    await handler("fusionPowerUser.copyModelName")({ label: "orders" });
    expect(copied).toEqual(["orders"]);
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
      await handler("fusionPowerUser.showCompiledSQL")();
      expect(lastCall(window.showTextDocument as Mock)).toEqual([
        { doc: 1 },
        expect.objectContaining({ preserveFocus: true, preview: false }),
      ]);
    });

    it("does nothing without an active editor", async () => {
      const { handler } = build();
      await handler("fusionPowerUser.showCompiledSQL")();
      expect((workspace.openTextDocument as Mock).mock.calls).toEqual([]);
    });
  });
});
