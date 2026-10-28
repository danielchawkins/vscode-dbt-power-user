import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { commands, extensions, Uri, window, workspace } from "vscode";
import {
  FusionPowerUserExtension,
  type ExtensionServices,
} from "../../dbtPowerUserExtension";
import {
  CONNECTED_COLUMNS_COMMAND,
  PARENT_TABLES_COMMAND,
} from "../../features/lineage/connectedColumnsCommand";
import { ProjectConfigCommands } from "../../features/projectSetup/projectConfigCommands";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { ProjectRegistry } from "../../projects/registry/projectRegistry";
import { StartupGate } from "../../startupGate";
import { createMockLogOutputChannel } from "../mock/vscode";

const UPSTREAM_EXTENSION = "innoverio.vscode-dbt-power-user";
const UNINSTALL_ACTION = "Uninstall Power User";

/** An extension built through its constructor from fakes; `services` fields not given are inert. */
function extensionWith(
  services: Partial<Record<keyof ExtensionServices, unknown>>,
  owned: { dispose(): unknown }[] = [],
): FusionPowerUserExtension {
  const inert = { dispose: vi.fn() };
  const defaults: Record<keyof ExtensionServices, unknown> = {
    projects: inert,
    statusBars: inert,
    log: inert,
    projectRegistry: inert,
    fusionClientPool: inert,
    fusionStatus: inert,
    startupGate: new StartupGate(),
    dbtLineageService: inert,
    projectEnvironments: inert,
  };
  return new FusionPowerUserExtension(
    { ...defaults, ...services } as ExtensionServices,
    owned,
  );
}

const activationHarness = (enabled: boolean, registry?: ProjectRegistry) => {
  /** The startup steps that ran, in order. */
  const started: string[] = [];
  /** What each awaited startup step does when it runs; tests replace these. */
  const behavior = {
    registry: () => Promise.resolve(),
    projects: () => Promise.resolve(),
  };
  const errors: unknown[][] = [];
  const registryProjects: unknown[] = [];
  const listeners: Array<() => void> = [];
  const extension = extensionWith({
    projects: {
      setContext: vi.fn(),
      initialize: () => {
        started.push("projects");
        return behavior.projects();
      },
    },
    projectRegistry: registry ?? {
      declareFromDocuments: vi.fn(),
      projects: registryProjects,
      initialize: () => {
        started.push("registry");
        return behavior.registry();
      },
      onDidChangeProjects: (listener: () => void) => {
        listeners.push(listener);
        return {
          dispose: () => listeners.splice(listeners.indexOf(listener), 1),
        };
      },
    },
    fusionClientPool: { initialize: () => started.push("pool") },
    fusionStatus: { initialize: () => started.push("status") },
    statusBars: {
      initialize: () => {
        started.push("statusBars");
        return Promise.resolve();
      },
    },
    log: { error: (...args: unknown[]) => errors.push(args) },
    startupGate: new StartupGate(),
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
    /** Simulates a folder being enabled so the registry gains a project. */
    registerProject: () => {
      registryProjects.push({});
      [...listeners].forEach((listener) => listener());
    },
  };
};

describe("FusionPowerUserExtension startup gate", () => {
  const gatedCommand = (extension: FusionPowerUserExtension) => {
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
    expect(harness.started).toEqual(["registry"]);
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

describe("FusionPowerUserExtension.activate", () => {
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
    // Nothing was owned at construction, so any entry would be one activation added after the conflict.
    expect(
      (harness.extension as unknown as { disposables: unknown[] }).disposables,
    ).toHaveLength(0);
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

  it("starts only the registry when every folder is disabled", async () => {
    const harness = activationHarness(false);

    await harness.extension.activate();

    expect(harness.started).toEqual(["registry"]);
    expect((window.showErrorMessage as Mock).mock.calls).toEqual([]);
    expect(harness.errors).toEqual([]);
  });

  it("starts everything once a disabled folder is enabled and registers a project", async () => {
    const harness = activationHarness(false);
    await harness.extension.activate();

    harness.registerProject();
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.started).toEqual([
      "registry",
      "pool",
      "status",
      "projects",
      "statusBars",
    ]);
    harness.registerProject();
    expect(harness.started).toHaveLength(5);
    expect(harness.errors).toEqual([]);
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
    const extension = extensionWith({ fusionClientPool }, [
      disposable,
      fusionClientPool,
    ]);

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

describe("FusionPowerUserExtension opened-file call sites", () => {
  let tmpDir: string;
  let nestedDir: string;
  let modelPath: string;
  let folder: { uri: Uri; name: string; index: number };
  let enabled: boolean;
  let getWorkspaceFolder: Mock;

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const lastListener = (event: unknown) =>
    (event as Mock).mock.calls.at(-1)?.[0] as () => void;
  const configListeners = () =>
    (workspace.onDidChangeConfiguration as Mock).mock.calls.map(
      ([listener]) => listener as (event: unknown) => void,
    );
  const roots = (registry: ProjectRegistry) =>
    registry.projects.map((project) => realpathSync(project.root.fsPath));
  const modelIn = (scheme = "file") => ({
    uri: Object.assign(Uri.file(modelPath), { scheme }),
    languageId: "sql",
  });

  function setUp(enabledFolder: boolean) {
    enabled = enabledFolder;
    const registry = new ProjectRegistry(createMockLogOutputChannel());
    const harness = activationHarness(enabled, registry);
    (workspace as any).workspaceFolders = [folder];
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: (key: string, fallback: unknown) =>
        key === "enabled" ? enabled : fallback,
    });
    const declare = vi.spyOn(registry, "declareFromDocuments");
    return { harness, registry, declare };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-opened-file-"));
    nestedDir = path.join(tmpDir, "nested");
    modelPath = path.join(nestedDir, "models", "model.sql");
    mkdirSync(path.dirname(modelPath), { recursive: true });
    writeFileSync(
      path.join(nestedDir, "dbt_project.yml"),
      "name: nested\nprofile: nested\n",
    );
    writeFileSync(modelPath, "select 1\n");
    folder = { uri: Uri.file(tmpDir), name: "opened", index: 0 };
    (workspace as any).isTrusted = true;
    (window as any).visibleTextEditors = [];
    getWorkspaceFolder = vi
      .spyOn(workspace, "getWorkspaceFolder")
      .mockImplementation((uri: Uri) =>
        (workspace.workspaceFolders ?? []).find((candidate) =>
          uri.fsPath.startsWith(candidate.uri.fsPath + path.sep),
        ),
      ) as Mock;
    (workspace.onDidChangeConfiguration as Mock).mockClear();
    (workspace.onDidGrantWorkspaceTrust as Mock).mockClear();
    (workspace.onDidChangeWorkspaceFolders as Mock).mockClear();
  });

  afterEach(() => {
    getWorkspaceFolder.mockRestore();
    (workspace as any).isTrusted = true;
    (window as any).visibleTextEditors = [];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("declares the root of a file already open at activation", async () => {
    const { harness, registry, declare } = setUp(true);
    (window as any).visibleTextEditors = [{ document: modelIn() }];

    await harness.extension.activate();

    expect(declare).toHaveBeenCalledWith([modelIn()]);
    expect(roots(registry)).toEqual([realpathSync(nestedDir)]);
    expect(harness.errors).toEqual([]);
  });

  it("declares the root once the workspace is trusted", async () => {
    const { harness, registry } = setUp(true);
    (workspace as any).isTrusted = false;
    (window as any).visibleTextEditors = [{ document: modelIn() }];
    await harness.extension.activate();
    expect(roots(registry)).toEqual([]);

    (workspace as any).isTrusted = true;
    lastListener(workspace.onDidGrantWorkspaceTrust)();

    expect(roots(registry)).toEqual([realpathSync(nestedDir)]);
  });

  it("declares the root when fusionPowerUser.enabled turns on", async () => {
    const { harness, registry } = setUp(false);
    (window as any).visibleTextEditors = [{ document: modelIn() }];
    await harness.extension.activate();
    expect(roots(registry)).toEqual([]);

    enabled = true;
    for (const listener of configListeners()) {
      listener({ affectsConfiguration: () => true });
    }
    await flush();

    expect(roots(registry)).toEqual([realpathSync(nestedDir)]);
    expect(harness.started).toEqual([
      "pool",
      "status",
      "projects",
      "statusBars",
    ]);
    expect(harness.errors).toEqual([]);
  });

  it("declares the root when its folder joins the workspace", async () => {
    const { harness, registry } = setUp(true);
    (workspace as any).workspaceFolders = [];
    (window as any).visibleTextEditors = [{ document: modelIn() }];
    await harness.extension.activate();
    expect(roots(registry)).toEqual([]);

    (workspace as any).workspaceFolders = [folder];
    lastListener(workspace.onDidChangeWorkspaceFolders)();

    expect(roots(registry)).toEqual([realpathSync(nestedDir)]);
  });

  it("declares nothing for a document opened without an editor", async () => {
    const { harness, registry } = setUp(true);
    (workspace as any).textDocuments = [modelIn()];

    await harness.extension.activate();

    expect(roots(registry)).toEqual([]);
    expect(workspace.onDidOpenTextDocument).not.toHaveBeenCalled();
  });

  it("ignores documents whose scheme is not file, on activation and every rescan", async () => {
    const { harness, registry } = setUp(true);
    (window as any).visibleTextEditors = [
      { document: modelIn("untitled") },
      { document: modelIn("git") },
    ];

    await harness.extension.activate();
    expect(roots(registry)).toEqual([]);

    lastListener(workspace.onDidGrantWorkspaceTrust)();
    for (const listener of configListeners()) {
      listener({ affectsConfiguration: () => true });
    }
    lastListener(workspace.onDidChangeWorkspaceFolders)();

    expect(roots(registry)).toEqual([]);
    expect(harness.errors).toEqual([]);
  });
});
