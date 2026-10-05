import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { commands, extensions, Uri, window, workspace } from "vscode";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import {
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
} from "../../features/lineage/connectedColumnsCommand";
import { ProjectConfigCommands } from "../../features/projectSetup/projectConfigCommands";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/fusionClientDiagnostics";
import { CONFIGURATION_SECTION } from "../../settings";
import { StartupGate } from "../../startupGate";

const UPSTREAM_EXTENSION = "innoverio.vscode-dbt-power-user";
const UNINSTALL_ACTION = "Uninstall Power User";

const activationHarness = (enabled: boolean) => {
  const initializeProjects = vi.fn(() => Promise.resolve());
  const initializeStatusBars = vi.fn(() => Promise.resolve());
  const registryInitialize = vi.fn(() => Promise.resolve());
  const fusionClientPoolInitialize = vi.fn();
  const fusionStatusInitialize = vi.fn();
  const extension = new (DBTPowerUserExtension as any)() as any;
  Object.assign(extension, {
    projects: {
      setContext: vi.fn(),
      initialize: initializeProjects,
    },
    projectRegistry: { initialize: registryInitialize },
    fusionClientPool: { initialize: fusionClientPoolInitialize },
    fusionStatus: { initialize: fusionStatusInitialize },
    currentProject: {},
    statusBars: { initialize: initializeStatusBars },
    dbtTerminal: { error: vi.fn() },
    runHistoryService: { dispose: vi.fn() },
    sharedState: { dispose: vi.fn() },
    startupGate: new StartupGate(),
    disposables: [],
  });

  const folder = { uri: Uri.file("/workspace"), name: "workspace", index: 0 };
  (workspace as any).workspaceFolders = [folder];
  (workspace.getConfiguration as Mock).mockReturnValue({
    get: vi.fn((key: string, fallback: unknown) =>
      key === "enabled" ? enabled : fallback,
    ),
  });

  return {
    extension,
    folder,
    initializeProjects,
    initializeStatusBars,
    registryInitialize,
    fusionClientPoolInitialize,
    fusionStatusInitialize,
    dbtTerminal: extension.dbtTerminal,
  };
};

describe("DBTPowerUserExtension startup gate", () => {
  const gatedCommand = (extension: DBTPowerUserExtension) => {
    const requireForCommand = vi.fn(() => Promise.resolve(undefined));
    new ProjectConfigCommands(
      (extension as any).startupGate,
      { requireForCommand } as never,
      () => ({ warn: vi.fn() }) as never,
    );
    const registration = (commands.registerCommand as Mock).mock.calls.find(
      ([command]) => command === "fusionPowerUser.enableStrictAnalysis",
    );
    return {
      run: registration![1] as () => Promise<boolean>,
      requireForCommand,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (extensions.getExtension as Mock).mockReturnValue(undefined);
    (window.showErrorMessage as Mock).mockReturnValue(Promise.resolve());
  });

  it("holds gated commands until startup settles", async () => {
    const harness = activationHarness(true);
    let finishRegistry: () => void = () => {};
    harness.registryInitialize.mockImplementation(
      () => new Promise<void>((resolve) => (finishRegistry = resolve)),
    );
    const command = gatedCommand(harness.extension);

    const ready = harness.extension.activate();
    const run = command.run();
    await new Promise((resolve) => setImmediate(resolve));
    expect(command.requireForCommand).not.toHaveBeenCalled();

    finishRegistry();
    await ready;
    await expect(run).resolves.toBe(false);
    expect(command.requireForCommand).toHaveBeenCalled();
  });

  it("runs gated commands when disabled for every folder", async () => {
    const harness = activationHarness(false);
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.registryInitialize).not.toHaveBeenCalled();
  });

  it("runs gated commands when Power User is installed", async () => {
    const harness = activationHarness(true);
    (extensions.getExtension as Mock).mockReturnValue({
      id: UPSTREAM_EXTENSION,
    });
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.registryInitialize).not.toHaveBeenCalled();
  });

  it("runs gated commands when the project registry fails to initialize", async () => {
    const harness = activationHarness(true);
    harness.registryInitialize.mockImplementation(() =>
      Promise.reject(new Error("boom")),
    );
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.dbtTerminal.error).toHaveBeenCalled();
    expect(harness.initializeProjects).not.toHaveBeenCalled();
  });

  it("runs gated commands after dispose without activation", async () => {
    const harness = activationHarness(true);
    const command = gatedCommand(harness.extension);

    harness.extension.dispose();

    await expect(command.run()).resolves.toBe(false);
  });
});

describe("DBTPowerUserExtension.activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (extensions.getExtension as Mock).mockReturnValue(undefined);
    (window.showErrorMessage as Mock).mockReturnValue(Promise.resolve());
  });

  it("offers to uninstall Power User and stops activation on conflict", async () => {
    const harness = activationHarness(true);
    (extensions.getExtension as Mock).mockReturnValue({
      id: UPSTREAM_EXTENSION,
    });
    (window.showErrorMessage as Mock).mockReturnValue(
      Promise.resolve(UNINSTALL_ACTION),
    );

    await harness.extension.activate();

    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("dbt Power User"),
      { modal: true },
      UNINSTALL_ACTION,
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.extensions.uninstallExtension",
      UPSTREAM_EXTENSION,
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.reloadWindow",
    );
    expect(harness.registryInitialize).not.toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).not.toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).not.toHaveBeenCalled();
    expect(harness.initializeProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
    expect(harness.extension.disposables).toHaveLength(0);
  });

  it("registers harness commands before the conflict modal is answered", async () => {
    const harness = activationHarness(true);
    const previous = process.env.FPU_INTEGRATION_COMMANDS;
    process.env.FPU_INTEGRATION_COMMANDS = "1";
    (extensions.getExtension as Mock).mockReturnValue({
      id: UPSTREAM_EXTENSION,
    });
    let answer: (value: undefined) => void = () => {};
    (window.showErrorMessage as Mock).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );

    try {
      const ready = harness.extension.activate();

      const registered = (commands.registerCommand as Mock).mock.calls.map(
        ([command]) => command,
      );
      expect(registered).toEqual(
        expect.arrayContaining([
          FUSION_CLIENT_STATES_COMMAND,
          CONNECTED_COLUMNS_COMMAND,
          PARENT_TABLES_COMMAND,
        ]),
      );
      answer(undefined);
      await ready;
      expect(harness.registryInitialize).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.FPU_INTEGRATION_COMMANDS;
      } else {
        process.env.FPU_INTEGRATION_COMMANDS = previous;
      }
    }
  });

  it("resolves ready and logs when a startup step throws", async () => {
    const harness = activationHarness(true);
    const failure = new Error("boom");
    harness.initializeProjects.mockImplementation(() =>
      Promise.reject(failure),
    );

    await expect(harness.extension.activate()).resolves.toBeUndefined();

    expect(harness.dbtTerminal.error).toHaveBeenCalledWith(
      "extensionActivationError",
      expect.any(String),
      failure,
    );
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
  });

  it("stops startup after dispose during an await", async () => {
    const harness = activationHarness(true);
    let finishRegistry: () => void = () => {};
    harness.registryInitialize.mockImplementation(
      () => new Promise<void>((resolve) => (finishRegistry = resolve)),
    );

    const ready = harness.extension.activate();
    harness.extension.dispose();
    finishRegistry();
    await ready;

    expect(harness.fusionStatusInitialize).not.toHaveBeenCalled();
    expect(harness.initializeProjects).not.toHaveBeenCalled();
  });

  it("stops activation silently when disabled for the workspace folder", async () => {
    const harness = activationHarness(false);

    await harness.extension.activate();

    expect(workspace.getConfiguration).toHaveBeenCalledWith(
      CONFIGURATION_SECTION,
      harness.folder.uri,
    );
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(harness.registryInitialize).not.toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).not.toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).not.toHaveBeenCalled();
    expect(harness.initializeProjects).not.toHaveBeenCalled();
    expect(harness.initializeStatusBars).not.toHaveBeenCalled();
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
    expect(harness.extension.disposables).toHaveLength(0);
  });

  it("activates when any workspace folder remains enabled", async () => {
    const harness = activationHarness(false);
    const enabledFolder = {
      uri: Uri.file("/enabled"),
      name: "enabled",
      index: 1,
    };
    (workspace as any).workspaceFolders = [harness.folder, enabledFolder];
    (workspace.getConfiguration as Mock).mockImplementation(
      (...args: unknown[]) => ({
        get: () => (args[1] as Uri).fsPath === enabledFolder.uri.fsPath,
      }),
    );

    await harness.extension.activate();

    expect(harness.registryInitialize).toHaveBeenCalledTimes(1);
    expect(harness.initializeProjects).toHaveBeenCalledTimes(1);
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
  });

  it("deactivate awaits pool stop before disposing collaborators", async () => {
    const order: string[] = [];
    const fusionClientPool = {
      initialize: vi.fn(),
      stop: vi.fn(async () => {
        order.push("pool.stop");
      }),
      dispose: vi.fn(() => {
        order.push("pool.dispose");
      }),
    };
    const disposable = { dispose: vi.fn(() => order.push("other.dispose")) };
    const extension = new (
      DBTPowerUserExtension as any
    )() as DBTPowerUserExtension;
    Object.assign(extension, {
      fusionClientPool,
      startupGate: new StartupGate(),
      disposables: [disposable, fusionClientPool],
    });

    await extension.deactivate();

    expect(fusionClientPool.stop).toHaveBeenCalledTimes(1);
    expect(order.indexOf("pool.stop")).toBeLessThan(
      order.indexOf("other.dispose"),
    );
  });

  it("activates startup steps without global executable detection", async () => {
    const harness = activationHarness(true);

    await harness.extension.activate();

    expect(harness.registryInitialize).toHaveBeenCalled();
    expect(harness.fusionClientPoolInitialize).toHaveBeenCalled();
    expect(harness.fusionStatusInitialize).toHaveBeenCalled();
    expect(harness.initializeProjects).toHaveBeenCalled();
    expect(harness.initializeStatusBars).toHaveBeenCalled();

    const registryCall = (harness.registryInitialize as Mock).mock
      .invocationCallOrder[0];
    const poolCall = (harness.fusionClientPoolInitialize as Mock).mock
      .invocationCallOrder[0];
    const statusCall = (harness.fusionStatusInitialize as Mock).mock
      .invocationCallOrder[0];
    const projectsCall = (harness.initializeProjects as Mock).mock
      .invocationCallOrder[0];
    expect(registryCall).toBeLessThan(poolCall);
    expect(poolCall).toBeLessThan(statusCall);
    expect(statusCall).toBeLessThan(projectsCall);
    expect(harness.dbtTerminal.error).not.toHaveBeenCalled();
  });
});
