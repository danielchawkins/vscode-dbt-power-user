import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  ConfigurationChangeEvent,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import {
  FUSION_PATH_SETTING,
  FusionExecutableResolver,
} from "../../fusion/fusionExecutable";
import {
  createStaticAnalysisSelection,
  StaticAnalysisSelection,
} from "../../fusion/staticAnalysisMode";
import { FusionClientPoolImpl } from "../../lsp/fusionClientPool";
import {
  LINT_ENABLED_SETTING,
  TRACE_SERVER_SETTING,
} from "../../lsp/fusionClientSettings";
import {
  FailedFusionClient,
  FusionClient,
  FusionClientFactory,
  FusionClientOptions,
} from "../../lsp/fusionLanguageClient";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";
import { createMockLogOutputChannel } from "../mock/vscode";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

function makeProject(name: string, rootPath: string): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

class FakeRegistry {
  private readonly listeners: Array<() => void> = [];
  projects: DeclaredProject[] = [];

  get onDidChangeProjects() {
    return (listener: () => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }

  setProjects(projects: DeclaredProject[]): void {
    this.projects = projects;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

class FakeClient implements FusionClient {
  readonly onDidChangeState = (
    _listener: (state: FusionClient["state"]) => void,
  ) => ({ dispose: () => {} });
  readonly onDidChangeStaticAnalysis = (
    _listener: (selection: StaticAnalysisSelection) => void,
  ) => ({ dispose: () => {} });
  readonly staticAnalysis = createStaticAnalysisSelection("baseline");
  readonly outputChannel = createMockLogOutputChannel("dbt Fusion LSP (test)");
  readonly failureReason = undefined;
  restart = jest.fn(() => Promise.resolve());
  stop = jest.fn(() => Promise.resolve());
  dispose = jest.fn();
  async request<T>(): Promise<T> {
    return undefined as T;
  }

  constructor(
    readonly project: DeclaredProject,
    readonly options: FusionClientOptions | undefined,
    readonly state: FusionClient["state"] = "running",
  ) {}
}

describe("FusionClientPool", () => {
  let terminal: { warn: jest.Mock; error: jest.Mock };
  let registry: FakeRegistry;
  let resolver: jest.Mocked<FusionExecutableResolver>;
  let factory: jest.Mocked<FusionClientFactory>;
  let configListener: ((event: ConfigurationChangeEvent) => void) | undefined;
  let lintEnabled = true;

  beforeEach(() => {
    terminal = { warn: jest.fn(), error: jest.fn() };
    registry = new FakeRegistry();
    resolver = {
      resolve: jest.fn(),
    } as jest.Mocked<FusionExecutableResolver>;
    factory = {
      create: jest.fn(
        (options: FusionClientOptions) =>
          new FakeClient(options.project, options),
      ),
    } as jest.Mocked<FusionClientFactory>;
    lintEnabled = true;

    jest
      .spyOn(workspace, "onDidChangeConfiguration")
      .mockImplementation((listener) => {
        configListener = listener as (event: ConfigurationChangeEvent) => void;
        return { dispose: jest.fn() };
      });
    jest.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === LINT_ENABLED_SETTING) {
          return lintEnabled;
        }
        if (key === "staticAnalysisMode") {
          return "baseline";
        }
        return undefined;
      }),
    } as any);
  });

  afterEach(() => {
    jest.mocked(workspace.onDidChangeConfiguration).mockRestore();
    jest.mocked(workspace.getConfiguration).mockRestore();
  });

  function createPool(): FusionClientPoolImpl {
    return new FusionClientPoolImpl(
      registry as unknown as ProjectRegistry,
      terminal as any,
      resolver,
      factory,
    );
  }

  it("does not create clients before initialize", async () => {
    const pool = createPool();
    registry.setProjects([makeProject("general", "/workspace/general")]);
    await flushAsync();

    expect(factory.create).not.toHaveBeenCalled();
    await pool.stop();
  });

  it("reconciles one client per declared project with stable identity", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    const first = pool.get(project);
    expect(first).toBeDefined();
    expect(factory.create).toHaveBeenCalledTimes(1);

    registry.setProjects([project]);
    await flushAsync();

    expect(pool.get(project)).toBe(first);
    expect(factory.create).toHaveBeenCalledTimes(1);
    await pool.stop();
  });

  it("clears pool.get before awaiting client stop on removal", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    factory.create.mockImplementation((options: FusionClientOptions) => {
      const client = new FakeClient(options.project, options);
      client.stop = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            stopGate.then(resolve);
          }),
      );
      return client;
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    expect(pool.get(project)).toBeDefined();
    registry.setProjects([]);
    await flushAsync();
    expect(pool.get(project)).toBeUndefined();

    releaseStop?.();
    await flushAsync();
    await pool.stop();
  });

  it("clears pool.get before awaiting client stop on replace", async () => {
    const pool = createPool();
    let resolveFirst: (() => void) | undefined;
    const firstResolveGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let call = 0;
    resolver.resolve.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await firstResolveGate;
      }
      return {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      };
    });

    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    factory.create.mockImplementation((options: FusionClientOptions) => {
      const client = new FakeClient(options.project, options);
      client.stop = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            stopGate.then(resolve);
          }),
      );
      return client;
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    resolveFirst?.();
    await flushAsync();
    expect(pool.get(project)).toBeDefined();

    configListener?.({
      affectsConfiguration: (key: string, scope?: Uri) =>
        key === `${CONFIGURATION_SECTION}.${TRACE_SERVER_SETTING}` &&
        scope?.fsPath === project.root.fsPath,
    } as ConfigurationChangeEvent);
    await flushAsync();
    expect(pool.get(project)).toBeUndefined();

    releaseStop?.();
    await flushAsync();
    await pool.stop();
  });

  it("creates two clients for two projects and removes one on registry shrink", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");

    pool.initialize();
    registry.setProjects([general, sox]);
    await flushAsync();

    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(pool.get(general)).toBeDefined();
    expect(pool.get(sox)).toBeDefined();

    const removed = pool.get(sox)! as FakeClient;
    registry.setProjects([general]);
    await flushAsync();

    expect(removed.dispose).toHaveBeenCalled();
    expect(removed.stop).toHaveBeenCalled();
    expect(pool.get(sox)).toBeUndefined();
    await pool.stop();
  });

  it("does not spawn when executable resolution fails", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      kind: "notFound",
      path: "/missing/dbt",
      source: "configured",
    });

    pool.initialize();
    registry.setProjects([makeProject("general", "/workspace/general")]);
    await flushAsync();

    expect(factory.create).not.toHaveBeenCalled();
    expect(
      pool.get(makeProject("general", "/workspace/general")),
    ).toBeInstanceOf(FailedFusionClient);
    expect(terminal.warn).toHaveBeenCalled();
    await pool.stop();
  });

  it("serializes concurrent registry events into one client", async () => {
    const pool = createPool();
    let resolveGate: (() => void) | undefined;
    const resolveBlocked = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    resolver.resolve.mockImplementation(async () => {
      await resolveBlocked;
      return {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      };
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    registry.setProjects([project]);
    resolveGate?.();
    await flushAsync();

    expect(factory.create).toHaveBeenCalledTimes(1);
    await pool.stop();
  });

  it("creates zero clients when stopped during pending resolution", async () => {
    const pool = createPool();
    let resolveGate: (() => void) | undefined;
    const resolveBlocked = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    resolver.resolve.mockImplementation(async () => {
      await resolveBlocked;
      return {
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      };
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    const stopPromise = pool.stop();
    resolveGate?.();
    await stopPromise;
    await flushAsync();

    expect(factory.create).not.toHaveBeenCalled();
    expect(pool.get(project)).toBeUndefined();
  });

  it("replaces the client when the project object at the same root changes", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const firstProject = makeProject("general", "/workspace/general");
    const replacement = makeProject("general-renamed", "/workspace/general");

    pool.initialize();
    registry.setProjects([firstProject]);
    await flushAsync();
    const firstClient = pool.get(firstProject)! as FakeClient;

    registry.setProjects([replacement]);
    await flushAsync();

    expect(firstClient.dispose).toHaveBeenCalled();
    expect(firstClient.stop).toHaveBeenCalled();
    expect(pool.get(replacement)).not.toBe(firstClient);
    expect(factory.create).toHaveBeenCalledTimes(2);
    await pool.stop();
  });

  it("replaces only the affected project on launch configuration changes", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");

    pool.initialize();
    registry.setProjects([general, sox]);
    await flushAsync();

    const generalClient = pool.get(general)! as FakeClient;
    const soxClient = pool.get(sox)! as FakeClient;

    lintEnabled = false;
    configListener?.({
      affectsConfiguration: (key: string, scope?: Uri) =>
        key === `${CONFIGURATION_SECTION}.${LINT_ENABLED_SETTING}` &&
        scope?.fsPath === general.root.fsPath,
    } as ConfigurationChangeEvent);
    await flushAsync();

    expect(generalClient.restart).not.toHaveBeenCalled();
    expect(generalClient.dispose).toHaveBeenCalled();
    expect(soxClient.dispose).not.toHaveBeenCalled();
    expect(factory.create).toHaveBeenCalledTimes(3);
    const latestGeneral =
      factory.create.mock.calls[factory.create.mock.calls.length - 1]?.[0];
    expect(latestGeneral?.lintEnabled).toBe(false);
    await pool.stop();
  });

  it("re-resolves executable when fusionPath changes", async () => {
    const pool = createPool();
    resolver.resolve
      .mockResolvedValueOnce({
        path: "/opt/dbt-old",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      })
      .mockResolvedValueOnce({
        path: "/opt/dbt-new",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
        env: {},
      });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    const firstClient = pool.get(project)! as FakeClient;
    configListener?.({
      affectsConfiguration: (key: string, scope?: Uri) =>
        key === `${CONFIGURATION_SECTION}.${FUSION_PATH_SETTING}` &&
        scope?.fsPath === project.root.fsPath,
    } as ConfigurationChangeEvent);
    await flushAsync();

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(firstClient.dispose).toHaveBeenCalled();
    const latestCall =
      factory.create.mock.calls[factory.create.mock.calls.length - 1]?.[0];
    expect(latestCall?.executable.path).toBe("/opt/dbt-new");
    await pool.stop();
  });

  it("replaces the affected project when traceServer changes", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    const firstClient = pool.get(project)! as FakeClient;
    configListener?.({
      affectsConfiguration: (key: string, scope?: Uri) =>
        key === `${CONFIGURATION_SECTION}.${TRACE_SERVER_SETTING}` &&
        scope?.fsPath === project.root.fsPath,
    } as ConfigurationChangeEvent);
    await flushAsync();

    expect(firstClient.dispose).toHaveBeenCalled();
    expect(factory.create).toHaveBeenCalledTimes(2);
    await pool.stop();
  });

  it("passes lintEnabled from launch settings to the factory", async () => {
    lintEnabled = false;
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({ lintEnabled: false }),
    );
    await pool.stop();
  });

  it("logs failed enqueue operations and keeps processing later work", async () => {
    const pool = createPool();
    resolver.resolve.mockRejectedValue(new Error("resolve failed"));

    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    expect(terminal.error).toHaveBeenCalledWith(
      "fusionClientPool",
      "Fusion client pool operation failed",
      expect.any(Error),
    );
    expect(factory.create).not.toHaveBeenCalled();

    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });
    registry.setProjects([project]);
    await flushAsync();

    expect(factory.create).toHaveBeenCalledTimes(1);
    await pool.stop();
  });

  it("stop awaits every managed client", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5" },
      env: {},
    });

    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    pool.initialize();
    registry.setProjects([general, sox]);
    await flushAsync();

    const generalClient = pool.get(general)! as FakeClient;
    const soxClient = pool.get(sox)! as FakeClient;

    await pool.stop();

    expect(generalClient.stop).toHaveBeenCalled();
    expect(soxClient.stop).toHaveBeenCalled();
    expect(pool.get(general)).toBeUndefined();
  });
});

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}
