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
  /** The startup steps that ran, in order. */
  const started: string[] = [];
  /** What each awaited startup step does when it runs; tests replace these. */
  const behavior = {
    registry: () => Promise.resolve(),
    projects: () => Promise.resolve(),
  };
  const errors: unknown[][] = [];
  const extension = new (DBTPowerUserExtension as any)();
  Object.assign(extension, {
    projects: {
      setContext: vi.fn(),
      initialize: () => {
        started.push("projects");
        return behavior.projects();
      },
    },
    projectRegistry: {
      initialize: () => {
        started.push("registry");
        return behavior.registry();
      },
    },
    fusionClientPool: { initialize: () => started.push("pool") },
    fusionStatus: { initialize: () => started.push("status") },
    currentProject: {},
    statusBars: {
      initialize: () => {
        started.push("statusBars");
        return Promise.resolve();
      },
    },
    dbtTerminal: { error: (...args: unknown[]) => errors.push(args) },
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
    started,
    behavior,
    errors,
  };
};

describe("DBTPowerUserExtension startup gate", () => {
  const gatedCommand = (extension: DBTPowerUserExtension) => {
    const asked: unknown[] = [];
    const requireForCommand = (uri: unknown) => {
      asked.push(uri);
      return Promise.resolve(undefined);
    };
    new ProjectConfigCommands(
      (extension as any).startupGate,
      { requireForCommand } as never,
      () => ({ warn: vi.fn() }) as never,
    );
    const registration = (commands.registerCommand as Mock).mock.calls.find(
      ([command]) => command === "fusionPowerUser.enableStrictAnalysis",
    );
    return {
      run: registration![1] as (uri?: Uri) => Promise<boolean>,
      asked,
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
    harness.behavior.registry = () =>
      new Promise<void>((resolve) => (finishRegistry = resolve));
    const command = gatedCommand(harness.extension);

    const ready = harness.extension.activate();
    const target = Uri.file("/workspace/models/a.sql");
    const run = command.run(target);
    await new Promise((resolve) => setImmediate(resolve));
    expect(command.asked).toEqual([]);

    finishRegistry();
    await ready;
    await expect(run).resolves.toBe(false);
    expect(command.asked).toEqual([target]);
  });

  it("runs gated commands when disabled for every folder", async () => {
    const harness = activationHarness(false);
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.started).toEqual([]);
  });

  it("runs gated commands when Power User is installed", async () => {
    const harness = activationHarness(true);
    (extensions.getExtension as Mock).mockReturnValue({
      id: UPSTREAM_EXTENSION,
    });
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.started).toEqual([]);
  });

  it("runs gated commands when the project registry fails to initialize", async () => {
    const harness = activationHarness(true);
    harness.behavior.registry = () => Promise.reject(new Error("boom"));
    const command = gatedCommand(harness.extension);

    await harness.extension.activate();

    await expect(command.run()).resolves.toBe(false);
    expect(harness.errors).toHaveLength(1);
    expect(harness.started).toEqual(["registry"]);
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

    expect((window.showErrorMessage as Mock).mock.calls).toEqual([
      [
        expect.stringContaining("dbt Power User"),
        { modal: true },
        UNINSTALL_ACTION,
      ],
    ]);
    expect((commands.executeCommand as Mock).mock.calls).toEqual([
      ["workbench.extensions.uninstallExtension", UPSTREAM_EXTENSION],
      ["workbench.action.reloadWindow"],
    ]);
    expect(harness.started).toEqual([]);
    expect(harness.errors).toEqual([]);
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
      expect(harness.started).toEqual([]);
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
    harness.behavior.projects = () => Promise.reject(failure);

    await expect(harness.extension.activate()).resolves.toBeUndefined();

    expect(harness.errors).toEqual([
      ["extensionActivationError", expect.any(String), failure],
    ]);
    expect(harness.started).toEqual(["registry", "pool", "status", "projects"]);
  });

  it("stops startup after dispose during an await", async () => {
    const harness = activationHarness(true);
    let finishRegistry: () => void = () => {};
    harness.behavior.registry = () =>
      new Promise<void>((resolve) => (finishRegistry = resolve));

    const ready = harness.extension.activate();
    harness.extension.dispose();
    finishRegistry();
    await ready;

    expect(harness.started).toEqual(["registry"]);
  });

  it("stops activation silently when disabled for the workspace folder", async () => {
    const harness = activationHarness(false);

    await harness.extension.activate();

    expect((workspace.getConfiguration as Mock).mock.calls).toEqual([
      [CONFIGURATION_SECTION, harness.folder.uri],
    ]);
    expect((window.showErrorMessage as Mock).mock.calls).toEqual([]);
    expect(harness.started).toEqual([]);
    expect(harness.errors).toEqual([]);
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

    expect(harness.started).toEqual([
      "registry",
      "pool",
      "status",
      "projects",
      "statusBars",
    ]);
    expect(harness.errors).toEqual([]);
  });

  it("deactivate awaits pool stop before disposing collaborators", async () => {
    const order: string[] = [];
    const fusionClientPool = {
      initialize: vi.fn(),
      stop: async () => {
        order.push("pool.stop");
      },
      dispose: () => {
        order.push("pool.dispose");
      },
    };
    const disposable = { dispose: () => order.push("other.dispose") };
    const extension = new (
      DBTPowerUserExtension as any
    )() as DBTPowerUserExtension;
    Object.assign(extension, {
      fusionClientPool,
      startupGate: new StartupGate(),
      disposables: [disposable, fusionClientPool],
    });

    await extension.deactivate();

    expect(order.filter((step) => step === "pool.stop")).toHaveLength(1);
    expect(order.indexOf("pool.stop")).toBeLessThan(
      order.indexOf("other.dispose"),
    );
  });

  it("activates startup steps without global executable detection", async () => {
    const harness = activationHarness(true);

    await harness.extension.activate();

    expect(harness.started).toEqual([
      "registry",
      "pool",
      "status",
      "projects",
      "statusBars",
    ]);
    expect(harness.errors).toEqual([]);
  });
});
