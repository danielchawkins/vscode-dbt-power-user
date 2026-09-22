import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ExtensionContext,
  extensions,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from "vscode";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { FusionClientPoolImpl } from "../../lsp/fusionClientPool";
import {
  DefaultFusionClientFactory,
  FailedFusionClient,
} from "../../lsp/fusionLanguageClient";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";

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
    jest.clearAllMocks();
    (extensions.getExtension as jest.Mock).mockReturnValue(undefined);
    (workspace as any).workspaceFolders = [folder];
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === "staticAnalysisMode") {
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
    jest.mocked(workspace.getConfiguration).mockRestore();
  });

  it("shows no window messages on enabled extension activation", async () => {
    const fusionClientPoolInitialize = jest.fn();
    const extension = Object.create(DBTPowerUserExtension.prototype) as any;
    Object.assign(extension, {
      dbtProjectContainer: {
        setContext: jest.fn(),
        detectDBT: jest.fn(() => Promise.resolve()),
        initializeDBTProjects: jest.fn(() => Promise.resolve()),
      },
      projectRegistry: { initialize: jest.fn(() => Promise.resolve()) },
      fusionClientPool: { initialize: fusionClientPoolInitialize },
      fusionStatus: { initialize: jest.fn() },
      projectContext: {},
      statusBars: { initialize: jest.fn(() => Promise.resolve()) },
      altimateAuthService: { isAuthenticated: jest.fn(() => false) },
      altimateRequest: {
        setCreditsRemainingListener: jest.fn(),
        setExecutionsExhaustedListener: jest.fn(),
      },
      dbtTerminal: { error: jest.fn() },
    });

    const context = { subscriptions: [] } as unknown as ExtensionContext;
    await extension.activate(context);

    expectNoWindowNotifications();
  });

  it("shows no window messages when Fusion LSP start fails", async () => {
    const terminal = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
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
      lintEnabled: true,
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
    const terminal = { warn: jest.fn(), error: jest.fn() };
    const registry = {
      projects: [makeProject()],
      onDidChangeProjects: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as ProjectRegistry;
    const resolver = {
      resolve: jest.fn(() =>
        Promise.resolve({ kind: "notFound", path: "/missing/dbt" }),
      ),
    };
    const factory = { create: jest.fn() };

    const pool = new FusionClientPoolImpl(
      registry,
      terminal as any,
      resolver as any,
      factory as any,
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
