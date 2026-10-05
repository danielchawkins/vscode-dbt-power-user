import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ConfigurationChangeEvent, Uri, workspace } from "vscode";
import { DBTDiagnosticData, DBTTerminal } from "../../dbt_integration";
import {
  ExecutableLifecycle,
  ExecutableLifecycleHooks,
  FusionCommandIntegrationFactory,
} from "../../fusion/executableLifecycle";
import { FusionCli } from "../../fusion/fusionCli";
import {
  DBT_PATH_SETTING,
  FusionExecutable,
} from "../../fusion/fusionExecutable";
import { CONFIGURATION_SECTION } from "../../settings";

const ROOT = "/workspace/project";

type Verdict =
  FusionExecutable | { kind: "notFound"; path: string; source: "configured" };

async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

async function drainMicrotasks(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    await Promise.resolve();
  }
}

function sampleExecutable(executablePath: string): FusionExecutable {
  return {
    path: executablePath,
    version: { major: 2, minor: 0, patch: 6, raw: "dbt 2.0.6\n" },
    env: {},
  };
}

function mockTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    trace: () => undefined,
    info: () => undefined,
    log: () => undefined,
    dispose: () => undefined,
  };
}

interface StubCli {
  path: string;
  dispose: Mock;
}

function recordingFactory(): {
  factory: FusionCommandIntegrationFactory;
  created: StubCli[];
} {
  const created: StubCli[] = [];
  const factory: FusionCommandIntegrationFactory = (executable) => {
    const cli: StubCli = {
      path: executable.path,
      dispose: vi.fn(async () => undefined),
    };
    created.push(cli);
    return cli as unknown as FusionCli;
  };
  return { factory, created };
}

function pathChangeEvent(root: string): ConfigurationChangeEvent {
  return {
    affectsConfiguration: (section: string, scope?: Uri) =>
      section === `${CONFIGURATION_SECTION}.${DBT_PATH_SETTING}` &&
      scope?.fsPath === root,
  };
}

function build(
  resolve: () => Promise<Verdict>,
  factory: FusionCommandIntegrationFactory,
  hooks: Partial<ExecutableLifecycleHooks> = {},
): ExecutableLifecycle {
  return new ExecutableLifecycle(
    { resolve: vi.fn(async () => resolve()) },
    factory,
    ROOT,
    mockTerminal(),
    {
      activate: hooks.activate ?? (async () => undefined),
      deactivate: hooks.deactivate ?? (() => undefined),
    },
  );
}

describe("ExecutableLifecycle", () => {
  let configListeners: Array<(event: ConfigurationChangeEvent) => void>;

  function changePath(root = ROOT): void {
    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }
  }

  beforeEach(() => {
    configListeners = [];
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
      (listener) => {
        configListeners.push(
          listener as (event: ConfigurationChangeEvent) => void,
        );
        return { dispose: vi.fn() };
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits the resolved executable and reports its version", async () => {
    const { factory, created } = recordingFactory();
    const lifecycle = build(async () => sampleExecutable("/bin/dbt"), factory);
    const committed = vi.fn();
    lifecycle.onDidCommit(committed);

    await lifecycle.initialize();

    expect(lifecycle.current()).toBe(created[0]);
    expect(lifecycle.version?.raw).toBe("dbt 2.0.6\n");
    expect(committed).toHaveBeenCalledTimes(1);
    await lifecycle.dispose();
    expect(created[0].dispose).toHaveBeenCalled();
  });

  it("reports resolution failure diagnostics without committing", async () => {
    const { factory, created } = recordingFactory();
    const lifecycle = build(
      async () => ({
        kind: "notFound",
        path: "/missing/dbt",
        source: "configured",
      }),
      factory,
    );
    const failures: Array<DBTDiagnosticData | undefined> = [];
    lifecycle.onDidFailResolution((diagnostic) => failures.push(diagnostic));

    await lifecycle.initialize();

    expect(failures).toEqual([
      expect.objectContaining({
        source: "fusion-executable",
        severity: "error",
        category: "project-config",
      }),
    ]);
    expect(lifecycle.current()).toBeUndefined();
    expect(created).toHaveLength(0);
    await lifecycle.dispose();
  });

  it("clears the failure and commits on a scoped dbtPath change", async () => {
    let configuredPath = "/missing/dbt";
    const { factory } = recordingFactory();
    const lifecycle = build(
      async () =>
        configuredPath.startsWith("/missing")
          ? { kind: "notFound", path: configuredPath, source: "configured" }
          : sampleExecutable(configuredPath),
      factory,
    );
    const failures: Array<DBTDiagnosticData | undefined> = [];
    lifecycle.onDidFailResolution((diagnostic) => failures.push(diagnostic));

    await lifecycle.initialize();
    changePath("/workspace/sibling");
    await drainMicrotasks();
    expect(lifecycle.current()).toBeUndefined();

    configuredPath = "/recovered/dbt";
    changePath();
    await waitFor(() => expect(lifecycle.current()).toBeDefined());

    expect(failures).toEqual([expect.anything(), undefined]);
    expect((lifecycle.current() as unknown as StubCli).path).toBe(
      "/recovered/dbt",
    );
    await lifecycle.dispose();
  });

  it("deactivates and disposes the committed CLI before re-resolving", async () => {
    const { factory, created } = recordingFactory();
    const order: string[] = [];
    const lifecycle = build(async () => sampleExecutable("/bin/dbt"), factory, {
      deactivate: () => order.push("deactivate"),
      activate: async () => {
        order.push("activate");
        return undefined;
      },
    });

    await lifecycle.initialize();
    changePath();
    await waitFor(() => expect(created).toHaveLength(2));
    await waitFor(() => expect(lifecycle.current()).toBe(created[1]));

    expect(order).toEqual(["activate", "deactivate", "activate"]);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    await lifecycle.dispose();
  });

  it("applies the last scoped dbtPath refresh when several arrive back-to-back", async () => {
    let configuredPath = "/project/v1/dbt";
    const { factory } = recordingFactory();
    const resolve = vi.fn(async () => sampleExecutable(configuredPath));
    const lifecycle = build(async () => resolve(), factory);

    await lifecycle.initialize();
    configuredPath = "/project/v2/dbt";
    changePath();
    configuredPath = "/project/v3/dbt";
    changePath();
    await waitFor(() => expect(resolve.mock.calls.length).toBe(3));
    await waitFor(() => expect(lifecycle.current()).toBeDefined());

    expect((lifecycle.current() as unknown as StubCli).path).toBe(
      "/project/v3/dbt",
    );
    await lifecycle.dispose();
  });

  it("ignores a refresh queued before dispose without running its body", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const activate = vi.fn(async () => {
      await gate;
      return undefined;
    });
    const resolve = vi.fn(async () => sampleExecutable("/project/dbt"));
    const { factory, created } = recordingFactory();
    const committed = vi.fn();
    const lifecycle = build(async () => resolve(), factory, { activate });
    lifecycle.onDidCommit(committed);

    const initPromise = lifecycle.initialize();
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    changePath();
    await lifecycle.dispose();
    releaseGate();
    await initPromise;
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(lifecycle.current()).toBeUndefined();
    expect(committed).not.toHaveBeenCalled();
  });

  it("propagates initialize errors while keeping the refresh chain alive", async () => {
    let fail = true;
    let configuredPath = "/project/v1/dbt";
    const resolve = vi.fn(async () => sampleExecutable(configuredPath));
    const { factory } = recordingFactory();
    const lifecycle = build(async () => resolve(), factory, {
      activate: async () => {
        if (fail) {
          throw new Error("rebuild failed");
        }
        return undefined;
      },
    });

    await expect(lifecycle.initialize()).rejects.toThrow("rebuild failed");
    expect(resolve.mock.calls.length).toBe(1);

    fail = false;
    configuredPath = "/project/v2/dbt";
    changePath();
    await waitFor(() => expect(resolve.mock.calls.length).toBe(2));
    await waitFor(() => expect(lifecycle.current()).toBeDefined());
    await lifecycle.dispose();
  });

  it("abandons and disposes a candidate that goes stale during activation", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const afterCommit = vi.fn();
    const { factory, created } = recordingFactory();
    const committed = vi.fn();
    const lifecycle = build(
      async () => sampleExecutable("/race/dbt"),
      factory,
      {
        activate: async () => {
          await gate;
          return afterCommit;
        },
      },
    );
    lifecycle.onDidCommit(committed);

    const initPromise = lifecycle.initialize();
    await waitFor(() => expect(created).toHaveLength(1));
    await lifecycle.dispose();
    releaseGate();
    await initPromise;

    expect(created[0].dispose).toHaveBeenCalled();
    expect(lifecycle.current()).toBeUndefined();
    expect(committed).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("runs the post-commit step only while its generation is current", async () => {
    const afterCommit = vi.fn();
    const { factory } = recordingFactory();
    const lifecycle = build(async () => sampleExecutable("/bin/dbt"), factory, {
      activate: async () => afterCommit,
    });

    await lifecycle.initialize();

    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(lifecycle.isCurrent(lifecycle.generation)).toBe(true);
    await lifecycle.dispose();
    expect(lifecycle.isCurrent(lifecycle.generation)).toBe(false);
  });
});
