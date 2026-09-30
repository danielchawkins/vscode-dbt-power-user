import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { extensions, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { toLspLaunch } from "../../core/lsp";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { FusionClientPoolImpl } from "../../fusion/fusionClientPool";
import {
  DefaultFusionClientFactory,
  FailedFusionClient,
} from "../../fusion/fusionLanguageClient";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { StartupGate } from "../../startupGate";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

function makeProject(rootPath = "/workspace/general"): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name: "general",
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

function expectNoWindowNotifications(): void {
  expect(window.showInformationMessage).not.toHaveBeenCalled();
  expect(window.showWarningMessage).not.toHaveBeenCalled();
  expect(window.showErrorMessage).not.toHaveBeenCalled();
}

describe("fusionNotificationPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (extensions.getExtension as Mock).mockReturnValue(undefined);
    (workspace as any).workspaceFolders = [folder];
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === "staticAnalysis") {
          return "baseline";
        }
        if (key === "enabled") {
          return fallback ?? true;
        }
        return fallback;
      }),
    } as any);
  });

  afterEach(() => {
    vi.mocked(workspace.getConfiguration).mockRestore();
  });

  it("shows no window messages on enabled extension activation", async () => {
    const fusionClientPoolInitialize = vi.fn();
    const extension = new (DBTPowerUserExtension as any)() as any;
    Object.assign(extension, {
      projects: {
        setContext: vi.fn(),
        initialize: vi.fn(() => Promise.resolve()),
      },
      projectRegistry: { initialize: vi.fn(() => Promise.resolve()) },
      fusionClientPool: { initialize: fusionClientPoolInitialize },
      fusionStatus: { initialize: vi.fn() },
      currentProject: {},
      statusBars: { initialize: vi.fn(() => Promise.resolve()) },
      dbtTerminal: { error: vi.fn() },
      runHistoryService: { dispose: vi.fn() },
      sharedState: { dispose: vi.fn() },
      startupGate: new StartupGate(),
    });

    await extension.activate();

    expectNoWindowNotifications();
  });

  it("shows no window messages when Fusion LSP start fails", async () => {
    const terminal = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const factory = new DefaultFusionClientFactory(terminal as any, {
      listenForServer: async () => {
        throw new Error("listen failed");
      },
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      },
      launch: toLspLaunch(readProjectSnapshot(makeProject().root)),
      commandPrefix: "fusionPowerUser:test:",
    });

    await flushAsync();
    expect(client.state).toBe("failed");
    expect(client.failureReason).toContain("listen failed");
    expectNoWindowNotifications();

    await client.stop();
    client.dispose();
  });

  it("shows no window messages for FailedFusionClient from the pool", async () => {
    const terminal = { warn: vi.fn(), error: vi.fn() };
    const registry = {
      projects: [makeProject()],
      onDidChangeProjects: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as ProjectRegistry;
    const resolver = {
      resolve: vi.fn(() =>
        Promise.resolve({ kind: "notFound", path: "/missing/dbt" }),
      ),
    };
    const factory = { create: vi.fn() };

    const pool = new FusionClientPoolImpl(
      registry,
      terminal as any,
      resolver as any,
      factory as any,
      { readSnapshot: readProjectSnapshot },
    );
    pool.initialize();
    await flushAsync();

    const client = pool.get(makeProject());
    expect(client).toBeInstanceOf(FailedFusionClient);
    expect(client?.state).toBe("failed");
    expectNoWindowNotifications();

    await pool.stop();
    pool.dispose();
  });
});

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}
