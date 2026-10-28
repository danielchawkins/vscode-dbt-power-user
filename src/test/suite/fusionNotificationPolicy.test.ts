import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { WorkspaceFolder } from "vscode";
import { extensions, Uri, window, workspace } from "vscode";
import { toLspLaunch } from "../../core/lsp";
import { FailedFusionClient } from "../../fusion/failedFusionClient";
import {
  FusionPowerUserExtension,
  type ExtensionServices,
} from "../../fusionPowerUserExtension";
import { DefaultFusionClientFactory } from "../../languageClient/defaultFusionClientFactory";
import { createFusionClientPool } from "../../projects/clients/fusionClientPool";
import { readProjectSnapshot } from "../../projects/clients/readProjectSnapshot";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/registry/projectRegistry";
import { StartupGate } from "../../startupGate";
import { flushAsync } from "../async";
import { createMockLogOutputChannel } from "../mock/vscode";
import { fakeProjectEnvironments } from "../projectHarness";

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
    origin: "explicit",
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
    const services = {
      projects: {
        setContext: vi.fn(),
        initialize: vi.fn(() => Promise.resolve()),
      },
      projectRegistry: { initialize: vi.fn(() => Promise.resolve()) },
      fusionClientPool: { initialize: fusionClientPoolInitialize },
      fusionStatus: { initialize: vi.fn() },
      statusBars: { initialize: vi.fn(() => Promise.resolve()) },
      log: { error: vi.fn() },
      startupGate: new StartupGate(),
      dbtLineageService: {},
      projectEnvironments: {},
    };
    const extension = new FusionPowerUserExtension(
      services as unknown as ExtensionServices,
      [],
    );

    await extension.activate();

    expectNoWindowNotifications();
  });

  it("shows no window messages when Fusion LSP start fails", async () => {
    const factory = new DefaultFusionClientFactory({
      rootExists: () => true,
      listenForServer: async () => {
        throw new Error("listen failed");
      },
      sleep: async () => {},
    });

    const client = factory.create({
      project: makeProject(),
      executable: {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      },
      launch: toLspLaunch(readProjectSnapshot(makeProject().root)),
      commandPrefix: "fusionPowerUser:test:",
      outputChannel: createMockLogOutputChannel("project"),
      targetPath: "/workspace/general/target",
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

    const pool = createFusionClientPool(registry, terminal as any, {
      resolver: resolver as any,
      factory,
      readSnapshot: readProjectSnapshot,
      environments: fakeProjectEnvironments(),
      outputChannel: () => createMockLogOutputChannel("project"),
      rootExists: () => true,
    });
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
