import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  type Mocked,
  vi,
} from "vitest";
import {
  ConfigurationChangeEvent,
  EventEmitter,
  LogOutputChannel,
  Uri,
  workspace,
  WorkspaceFolder,
} from "vscode";
import { StaticAnalysisMode } from "../../core/project";
import { FailedFusionClient } from "../../fusion/failedFusionClient";
import {
  DBT_PATH_SETTING,
  FusionExecutableResolver,
} from "../../fusion/fusionExecutable";
import {
  FusionClient,
  FusionClientFactory,
  FusionClientOptions,
  FusionProjectRef,
} from "../../fusion/fusionLanguageClient";
import {
  FusionClientPoolImpl,
  onCurrentClientChange,
} from "../../projects/fusionClientPool";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { schemaOriginLaunchEnv } from "../../projects/schemaOrigin";
import { CONFIGURATION_SECTION } from "../../settings";
import { flushAsync } from "../async";
import { createMockLogOutputChannel } from "../mock/vscode";
import { declaredProject, fakeProjectEnvironments } from "../projectHarness";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

const makeProject = (name: string, rootPath: string) =>
  declaredProject(name, rootPath, folder);

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
  readonly staticAnalysis: StaticAnalysisMode = "baseline";
  readonly outputChannel = createMockLogOutputChannel(
    "Fusion Power User: test",
  );
  readonly failureReason = undefined;
  restart = vi.fn(() => Promise.resolve());
  stop = vi.fn(() => Promise.resolve());
  dispose = vi.fn();
  async request<T>(): Promise<T> {
    return undefined as T;
  }

  constructor(
    readonly project: FusionProjectRef,
    readonly options: FusionClientOptions | undefined,
    readonly state: FusionClient["state"] = "running",
  ) {}
}

describe("FusionClientPool", () => {
  let terminal: { warn: Mock; error: Mock };
  let registry: FakeRegistry;
  let resolver: Mocked<FusionExecutableResolver>;
  let factory: Mocked<FusionClientFactory>;
  let configListener: ((event: ConfigurationChangeEvent) => void) | undefined;
  let settings: Record<string, unknown>;
  let channels: Map<string, LogOutputChannel>;
  let pools: FusionClientPoolImpl[];
  let environments: ReturnType<typeof fakeProjectEnvironments>;

  /** One channel per Declared Project root, as `OutputChannels.projectLog` keeps one per Declared Project. */
  function channelFor(project: DeclaredProject): LogOutputChannel {
    const key = project.root.fsPath;
    if (!channels.has(key)) {
      channels.set(
        key,
        createMockLogOutputChannel(`Fusion Power User: ${project.name}`),
      );
    }
    return channels.get(key)!;
  }

  /** Fires a change of `key` for `root`, first storing the value when one is given. */
  function changeSetting(key: string, root: Uri, ...update: [unknown?]): void {
    if (update.length) {
      settings[key] = update[0];
    }
    configListener?.({
      affectsConfiguration: (section: string, scope?: Uri) =>
        section === `${CONFIGURATION_SECTION}.${key}` &&
        scope?.fsPath === root.fsPath,
    });
  }

  beforeEach(() => {
    terminal = { warn: vi.fn(), error: vi.fn() };
    channels = new Map();
    pools = [];
    environments = fakeProjectEnvironments({ TOOL: "mise" });
    registry = new FakeRegistry();
    resolver = {
      resolve: vi.fn().mockResolvedValue({
        path: "/opt/dbt",
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      }),
    };
    factory = {
      create: vi.fn(
        (options: FusionClientOptions) =>
          new FakeClient(options.project, options),
      ),
    };
    settings = { "lint.enabled": true, staticAnalysis: "baseline" };

    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
      (listener) => {
        configListener = listener as (event: ConfigurationChangeEvent) => void;
        return { dispose: vi.fn() };
      },
    );
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: vi.fn((key: string) => settings[key]),
    } as any);
  });

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.stop()));
    vi.mocked(workspace.onDidChangeConfiguration).mockRestore();
    vi.mocked(workspace.getConfiguration).mockRestore();
  });

  function createPool(): FusionClientPoolImpl {
    const pool = new FusionClientPoolImpl(
      registry as unknown as ProjectRegistry,
      terminal as any,
      resolver,
      factory,
      {
        readSnapshot: readProjectSnapshot,
        environments,
        outputChannel: channelFor,
      },
    );
    pools.push(pool);
    return pool;
  }

  /** Initializes a pool over `projects` and returns it with each project's first client. */
  async function startPool(...projects: DeclaredProject[]) {
    const pool = createPool();
    pool.initialize();
    registry.setProjects(projects);
    await flushAsync();
    return { pool, clients: projects.map((p) => pool.get(p) as FakeClient) };
  }

  /** `client` was disposed exactly once and the factory has now built `creates` clients in all. */
  function expectRestarted(client: FakeClient, creates: number): void {
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect(factory.create).toHaveBeenCalledTimes(creates);
  }

  /** The options of the factory's latest `create` call. */
  const lastCreate = () => factory.create.mock.calls.at(-1)?.[0];

  it("does not create clients before initialize", async () => {
    const pool = createPool();
    registry.setProjects([makeProject("general", "/workspace/general")]);
    await flushAsync();

    expect(factory.create).not.toHaveBeenCalled();
    await pool.stop();
  });

  it("reconciles one client per declared project with stable identity", async () => {
    const project = makeProject("general", "/workspace/general");
    const {
      pool,
      clients: [first],
    } = await startPool(project);
    expect(first).toBeDefined();
    expect(factory.create).toHaveBeenCalledTimes(1);

    registry.setProjects([project]);
    await flushAsync();

    expect(pool.get(project)).toBe(first);
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it("clears pool.get before awaiting client stop on removal", async () => {
    const pool = createPool();
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
      env: {},
    });

    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    factory.create.mockImplementation((options: FusionClientOptions) => {
      const client = new FakeClient(options.project, options);
      client.stop = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            void stopGate.then(resolve);
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
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
        env: {},
      };
    });

    let releaseStop: (() => void) | undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    factory.create.mockImplementation((options: FusionClientOptions) => {
      const client = new FakeClient(options.project, options);
      client.stop = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            void stopGate.then(resolve);
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

    changeSetting("trace.server", project.root, "verbose");
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
      version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
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
    expect(channels.get("/workspace/general")?.warn).toHaveBeenCalledWith(
      expect.stringContaining("/missing/dbt"),
    );
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
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
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
        version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
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
    const firstProject = makeProject("general", "/workspace/general");
    const replacement = makeProject("general-renamed", "/workspace/general");
    const { pool, clients } = await startPool(firstProject);
    const [firstClient] = clients;

    registry.setProjects([replacement]);
    await flushAsync();

    expect(firstClient.stop).toHaveBeenCalled();
    expect(pool.get(replacement)).not.toBe(firstClient);
    expectRestarted(firstClient, 2);
  });

  it("replaces only the affected project on launch configuration changes", async () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    const {
      clients: [generalClient, soxClient],
    } = await startPool(general, sox);

    changeSetting("lint.enabled", general.root, false);
    await flushAsync();

    expect(generalClient.restart).not.toHaveBeenCalled();
    expect(soxClient.dispose).not.toHaveBeenCalled();
    expectRestarted(generalClient, 3);
    expect(lastCreate()?.launch.lintEnabled).toBe(false);
  });

  it("gives a replacement client its project's channel after a launch change", async () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    await startPool(general, sox);

    changeSetting("target", general.root, "prod");
    await flushAsync();

    const calls = factory.create.mock.calls.map(([options]) => options);
    const generalCalls = calls.filter((o) => o.project === general);
    const soxCall = calls.find((o) => o.project === sox);
    expect(generalCalls).toHaveLength(2);
    expect(generalCalls[1].launch.target).toBe("prod");
    expect(generalCalls[1].outputChannel).toBe(generalCalls[0].outputChannel);
    expect(generalCalls[0].outputChannel).toBe(channelFor(general));
    expect(soxCall?.outputChannel).toBe(channelFor(sox));
    expect(soxCall?.outputChannel).not.toBe(generalCalls[0].outputChannel);
  });

  it("re-resolves executable when fusionPath changes", async () => {
    const executable = (dbt: string) => ({
      path: dbt,
      version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
      env: {},
    });
    resolver.resolve
      .mockResolvedValueOnce(executable("/opt/dbt-old"))
      .mockResolvedValueOnce(executable("/opt/dbt-new"));
    const project = makeProject("general", "/workspace/general");
    const {
      clients: [firstClient],
    } = await startPool(project);

    changeSetting(DBT_PATH_SETTING, project.root, "/opt/dbt-new");
    await flushAsync();

    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(firstClient.dispose).toHaveBeenCalled();
    expect(lastCreate()?.executable.path).toBe("/opt/dbt-new");
  });

  it("replaces the affected project when traceServer changes", async () => {
    const project = makeProject("general", "/workspace/general");
    const {
      clients: [firstClient],
    } = await startPool(project);

    changeSetting("trace.server", project.root, "messages");
    await flushAsync();

    expectRestarted(firstClient, 2);
  });

  it("does not restart when a settings change leaves the launch equal", async () => {
    settings.target = "dev";
    const project = makeProject("general", "/workspace/general");
    const {
      pool,
      clients: [client],
    } = await startPool(project);
    const onChange = vi.fn();
    pool.onDidChangeClients(onChange);

    changeSetting("target", project.root, " dev ");
    changeSetting("defer.perProject", project.root, {});
    await flushAsync();

    expect(pool.get(project)).toBe(client);
    expect(client.dispose).not.toHaveBeenCalled();
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restarts exactly once when the target changes", async () => {
    const project = makeProject("general", "/workspace/general");
    const {
      clients: [client],
    } = await startPool(project);

    changeSetting("target", project.root, "prod");
    await flushAsync();
    changeSetting("target", project.root);
    await flushAsync();

    expectRestarted(client, 2);
    expect(factory.create.mock.calls[1][0].launch.target).toBe("prod");
  });

  it("restarts only the project whose profile changes", async () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    const {
      clients: [generalClient, soxClient],
    } = await startPool(general, sox);

    changeSetting("profile", general.root, " analytics ");
    await flushAsync();

    expectRestarted(generalClient, 3);
    expect(soxClient.dispose).not.toHaveBeenCalled();
    expect(lastCreate()?.launch.profile).toBe("analytics");
  });

  it("awaits the project's environment before resolving the executable or reading the snapshot", async () => {
    let release: (() => void) | undefined;
    environments.ensure.mockImplementationOnce(
      (_project) =>
        new Promise((resolve) => {
          release = () => resolve(environments.peek(_project));
        }),
    );
    const readSnapshot = vi.fn(readProjectSnapshot);
    const pool = new FusionClientPoolImpl(
      registry as unknown as ProjectRegistry,
      terminal as any,
      resolver,
      factory,
      { readSnapshot, environments, outputChannel: channelFor },
    );
    pools.push(pool);
    pool.initialize();
    registry.setProjects([makeProject("general", "/workspace/general")]);
    await flushAsync();

    expect(environments.ensure).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(factory.create).not.toHaveBeenCalled();

    release?.();
    await flushAsync();

    expect(readSnapshot).toHaveBeenCalledWith(expect.anything(), {
      TOOL: "mise",
    });
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it("relaunches only the client whose environment changed", async () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    const {
      clients: [generalClient, soxClient],
    } = await startPool(general, sox);

    environments.changed.fire(sox);
    await flushAsync();

    expect(generalClient.dispose).not.toHaveBeenCalled();
    expectRestarted(soxClient, 3);
    expect(lastCreate()?.project).toBe(sox);
  });

  it("does not restart a project the settings change does not affect", async () => {
    const {
      clients: [client],
    } = await startPool(makeProject("general", "/workspace/general"));

    changeSetting("target", Uri.file("/workspace/sox"), "prod");
    await flushAsync();

    expect(client.dispose).not.toHaveBeenCalled();
    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it("passes the snapshot launch to the factory", async () => {
    settings["lint.enabled"] = false;
    await startPool(makeProject("general", "/workspace/general"));

    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: expect.objectContaining({
          lintEnabled: false,
          staticAnalysis: "baseline",
          projectDir: "/workspace/general",
        }),
      }),
    );
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
      version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
      env: {},
    });
    registry.setProjects([project]);
    await flushAsync();

    expect(factory.create).toHaveBeenCalledTimes(1);
    await pool.stop();
  });

  it("stop awaits every managed client", async () => {
    const general = makeProject("general", "/workspace/general");
    const sox = makeProject("sox", "/workspace/sox");
    const {
      pool,
      clients: [generalClient, soxClient],
    } = await startPool(general, sox);

    await pool.stop();

    expect(generalClient.stop).toHaveBeenCalled();
    expect(soxClient.stop).toHaveBeenCalled();
    expect(pool.get(general)).toBeUndefined();
  });

  it("launches remote before a parse, relaunches local after a typed parse, and not when stable", async () => {
    resolver.resolve.mockResolvedValue({
      path: "/opt/dbt",
      version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6" },
      env: { FUSION_POWER_USER_SCHEMA_ORIGIN: "local" },
    });
    const dbtProject = {
      snapshot: undefined as unknown,
      get manifest(): unknown {
        return this.snapshot;
      },
      schemaOriginStatus: () => ({ kind: "local" }) as const,
    };
    const changed = new EventEmitter<unknown>();
    const resolve = vi.fn((_project: DeclaredProject) =>
      schemaOriginLaunchEnv(dbtProject),
    );
    const pool = new FusionClientPoolImpl(
      registry as unknown as ProjectRegistry,
      terminal as any,
      resolver,
      factory,
      {
        readSnapshot: readProjectSnapshot,
        environments,
        outputChannel: channelFor,
        launchEnv: { resolve, onDidChange: changed.event },
      },
    );
    const project = makeProject("general", "/workspace/general");
    pool.initialize();
    registry.setProjects([project]);
    await flushAsync();

    expect(factory.create.mock.calls[0][0].env).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "remote",
    });
    changed.fire(undefined);
    await flushAsync();
    expect(factory.create).toHaveBeenCalledTimes(1);

    dbtProject.snapshot = {};
    changed.fire(undefined);
    await flushAsync();
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(factory.create.mock.calls[1][0].env).toEqual({
      FUSION_POWER_USER_SCHEMA_ORIGIN: "local",
    });
    changed.fire(undefined);
    await flushAsync();
    expect(factory.create).toHaveBeenCalledTimes(2);
    await pool.stop();
  });
});

describe("onCurrentClientChange", () => {
  type Listener = () => void;
  const emitter = () => {
    const listeners = new Set<Listener>();
    return {
      event: (listener: Listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
      fire: () => listeners.forEach((listener) => listener()),
      count: () => listeners.size,
    };
  };

  function setup() {
    const first = makeProject("first", "/workspace/general/first");
    const second = makeProject("second", "/workspace/general/second");
    const clientsChanged = emitter();
    const switched = emitter();
    const states = new Map<DeclaredProject, ReturnType<typeof emitter>>([
      [first, emitter()],
      [second, emitter()],
    ]);
    const pool = {
      get: (project: DeclaredProject) => ({
        onDidChangeState: states.get(project)!.event,
      }),
      onDidChangeClients: clientsChanged.event,
    };
    const current = {
      current: first as DeclaredProject | undefined,
      onDidChangeCurrent: switched.event,
    };
    const listener = vi.fn();
    const subscription = onCurrentClientChange(
      pool as never,
      current as never,
    )(listener);
    return {
      first,
      second,
      clientsChanged,
      switched,
      states,
      current,
      listener,
      subscription,
    };
  }

  it("fires on a Current Project switch and follows the new project", () => {
    const { second, switched, states, current, listener } = setup();

    current.current = second;
    switched.fire();
    expect(listener).toHaveBeenCalledTimes(1);

    states.get(second)!.fire();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops following the previous project after a switch", () => {
    const { first, second, switched, states, current, listener } = setup();

    current.current = second;
    switched.fire();
    listener.mockClear();

    states.get(first)!.fire();
    expect(listener).not.toHaveBeenCalled();
  });

  it("fires when the current client is replaced", () => {
    const { clientsChanged, listener } = setup();

    clientsChanged.fire();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("fires on a state change of the current client only", () => {
    const { first, second, states, listener } = setup();

    states.get(first)!.fire();
    expect(listener).toHaveBeenCalledTimes(1);

    states.get(second)!.fire();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("releases its subscriptions on dispose", () => {
    const { first, clientsChanged, switched, states, subscription, listener } =
      setup();

    subscription.dispose();
    clientsChanged.fire();
    switched.fire();
    states.get(first)!.fire();

    expect(listener).not.toHaveBeenCalled();
    expect(states.get(first)!.count()).toBe(0);
  });
});
