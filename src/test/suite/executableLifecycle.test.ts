import * as path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { DiagnosticSeverity, Uri, window } from "vscode";
import { DBTDiagnosticData } from "../../core/diagnostics";
import {
  ExecutableLifecycle,
  ExecutableLifecycleHooks,
  FusionCommandIntegrationFactory,
} from "../../fusion/executableLifecycle";
import { FusionCli } from "../../fusion/fusionCli";
import { Project } from "../../projects/project";
import { SHOW_OUTPUT } from "../../projects/projectErrors";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { flushAsync, waitFor } from "../async";
import { createdFileSystemWatchers } from "../mock/vscode";
import {
  buildIntegration,
  captureConfigChanges,
  cleanUpProjects,
  createProjectRoot,
  notFound,
  recordingExecutionFactory,
  sampleExecutable,
  stubFusionCli,
  type Verdict,
} from "../projectHarness";
import { silentLog } from "../testLog";

const ROOT = "/workspace/project";
const ENV_MARKER = "FUSION_PU_CLI_ENV";

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

function build(
  resolve: () => Promise<Verdict>,
  factory: FusionCommandIntegrationFactory,
  hooks: Partial<ExecutableLifecycleHooks> = {},
): ExecutableLifecycle {
  return new ExecutableLifecycle(
    { resolve: vi.fn(async () => resolve()) },
    factory,
    ROOT,
    silentLog(),
    {
      activate: hooks.activate ?? (async () => undefined),
      deactivate: hooks.deactivate ?? (() => undefined),
    },
  );
}

describe("ExecutableLifecycle", () => {
  let config: ReturnType<typeof captureConfigChanges>;

  function changePath(root = ROOT): void {
    config.changePath(root);
  }

  beforeEach(() => {
    config = captureConfigChanges();
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
    await flushAsync();
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
    await flushAsync();

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

describe("Project executable wiring", () => {
  let config: ReturnType<typeof captureConfigChanges>;

  beforeEach(() => {
    config = captureConfigChanges();
  });

  afterEach(async () => {
    delete process.env[ENV_MARKER];
    await cleanUpProjects();
    vi.restoreAllMocks();
  });

  function fusionCliFactory(
    recording: ReturnType<typeof recordingExecutionFactory>,
    { stubRebuild = false } = {},
  ): FusionCommandIntegrationFactory {
    return (executable, root) => {
      const cli = new FusionCli(
        executable,
        () => readProjectSnapshot(Uri.file(root)),
        recording.factory,
        silentLog(),
      );
      if (stubRebuild) {
        vi.spyOn(cli, "rebuildManifest").mockResolvedValue(undefined);
      }
      return cli;
    };
  }

  function lifecycleFactory(
    root: string,
    hooks: Partial<FusionCli> = {},
  ): FusionCommandIntegrationFactory {
    return () => stubFusionCli(root, hooks);
  }

  function executableErrors(project: Project) {
    return project
      .getAllDiagnostic()
      .filter(
        (diagnostic) =>
          diagnostic.code === "fusion-executable" &&
          diagnostic.severity === DiagnosticSeverity.Error,
      );
  }

  function subcommands(
    recording: ReturnType<typeof recordingExecutionFactory>,
  ) {
    return recording.calls.map((call) => (call.args as string[])[0]);
  }

  it("spawns only dbt parse when a project activates", async () => {
    const root = createProjectRoot("activate");
    const recording = recordingExecutionFactory();
    const project = buildIntegration(
      root,
      async () => sampleExecutable("/bin/dbt"),
      fusionCliFactory(recording),
    );

    await project.initialize();

    expect(subcommands(recording)).toEqual(["parse"]);
  });

  it("executes CLI with per-project path and cwd, and the snapshot environment", async () => {
    const rootA = createProjectRoot("a");
    const rootB = createProjectRoot("b");
    process.env[ENV_MARKER] = "host";
    const recordingA = recordingExecutionFactory();
    const recordingB = recordingExecutionFactory();
    const projectA = buildIntegration(
      rootA,
      async () =>
        sampleExecutable("/project/a/bin/dbt", {
          [ENV_MARKER]: "executable-a",
        }),
      fusionCliFactory(recordingA, { stubRebuild: true }),
    );
    const projectB = buildIntegration(
      rootB,
      async () =>
        sampleExecutable("/project/b/bin/dbt", {
          [ENV_MARKER]: "executable-b",
        }),
      fusionCliFactory(recordingB, { stubRebuild: true }),
    );

    await projectA.initialize();
    await projectB.initialize();
    await projectA.getFusionCli().run({ kind: "deps" });
    await projectB.getFusionCli().run({ kind: "deps" });

    expect(recordingA.calls[0]).toMatchObject({
      command: "/project/a/bin/dbt",
      cwd: rootA,
      envVars: expect.objectContaining({ [ENV_MARKER]: "host" }),
    });
    expect(recordingB.calls[0]).toMatchObject({
      command: "/project/b/bin/dbt",
      cwd: rootB,
      envVars: expect.objectContaining({ [ENV_MARKER]: "host" }),
    });
  });

  it("records resolution failure diagnostics without initializing delegate", async () => {
    const project = buildIntegration(
      createProjectRoot("fail"),
      async () => notFound("/missing/dbt"),
      fusionCliFactory(recordingExecutionFactory(), { stubRebuild: true }),
    );

    await project.initialize();

    expect(executableErrors(project)).toHaveLength(1);
    expect(() => project.getFusionCli()).toThrow(/not initialized/);
  });

  const siblingTest =
    "keeps a healthy sibling initializing when one project's resolver fails, notifying only for it";
  it(siblingTest, async () => {
    const failedRoot = createProjectRoot("sibling-failed");
    const healthyRoot = createProjectRoot("sibling-healthy");
    const failed = buildIntegration(
      failedRoot,
      async () => notFound("/missing/dbt"),
      lifecycleFactory(failedRoot),
    );
    const refreshProjectConfig = vi.fn(async () => undefined);
    const healthy = buildIntegration(
      healthyRoot,
      async () => sampleExecutable("/opt/healthy/dbt"),
      lifecycleFactory(healthyRoot, { refreshProjectConfig }),
    );

    await Promise.all([failed.initialize(), healthy.initialize()]);

    expect(executableErrors(failed)).toHaveLength(1);
    expect(() => failed.getFusionCli()).toThrow(/not initialized/);
    expect(healthy.getFusionCli()).toBeDefined();
    expect(refreshProjectConfig).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("fusionPowerUser.dbtPath for "),
      SHOW_OUTPUT,
    );
    expect(vi.mocked(window.showErrorMessage).mock.calls[0][0]).toContain(
      "/missing/dbt",
    );
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("re-resolves on scoped path change, keeps sibling path, and executes B after A refresh", async () => {
    const rootA = createProjectRoot("refresh-a");
    const rootB = createProjectRoot("refresh-b");
    let pathA = "/missing/a/dbt";
    const recordingA = recordingExecutionFactory();
    const recordingB = recordingExecutionFactory();
    const projectA = buildIntegration(
      rootA,
      async () =>
        pathA.startsWith("/missing")
          ? notFound(pathA)
          : sampleExecutable(pathA),
      fusionCliFactory(recordingA, { stubRebuild: true }),
    );
    const projectB = buildIntegration(
      rootB,
      async () => sampleExecutable("/project/b/bin/dbt"),
      fusionCliFactory(recordingB, { stubRebuild: true }),
    );

    await projectA.initialize();
    await projectB.initialize();
    expect(() => projectA.getFusionCli()).toThrow();

    pathA = "/project/a/recovered/dbt";
    config.changePath(rootA);
    await waitFor(() => projectA.getFusionCli());
    await projectA.getFusionCli().run({ kind: "deps" });
    await projectB.getFusionCli().run({ kind: "deps" });

    expect(recordingA.calls[0]).toMatchObject({
      command: "/project/a/recovered/dbt",
      cwd: rootA,
    });
    expect(recordingB.calls[0]).toMatchObject({
      command: "/project/b/bin/dbt",
      cwd: rootB,
    });
  });

  it("clears the previous executable's rebuild diagnostics when re-resolution fails", async () => {
    const root = createProjectRoot("stale");
    let missing = false;
    const project = buildIntegration(
      root,
      async () =>
        missing ? notFound("/missing/dbt") : sampleExecutable("/bin/dbt"),
      lifecycleFactory(root, {
        getDiagnostics: () => ({
          projectConfigDiagnostics: [],
          rebuildManifestDiagnostics: [
            {
              message: "stale rebuild error",
              severity: "error",
              filePath: path.join(root, "models", "a.sql"),
              source: "dbt",
              category: "error",
            },
          ],
        }),
      }),
    );
    await project.initialize();
    project.updateDiagnosticsInProblemsPanel();
    expect(project.getAllDiagnostic().map((d) => d.code)).toEqual([
      "rebuild-manifest",
    ]);

    missing = true;
    config.changePath(root);
    await waitFor(() => expect(executableErrors(project)).toHaveLength(1));

    expect(project.getAllDiagnostic().map((d) => d.code)).toEqual([
      "fusion-executable",
    ]);
  });

  it.each(["refreshProjectConfig", "rebuildManifest"] as const)(
    "does not commit delegate or watchers when disposed during %s",
    async (gatedMethod) => {
      const root = createProjectRoot(`race-${gatedMethod}`);
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const gated = vi.fn(async () => {
        await gate;
      });
      const delegateDispose = vi.fn(() => undefined);
      const project = buildIntegration(
        root,
        async () => sampleExecutable("/project/race/dbt"),
        lifecycleFactory(root, {
          [gatedMethod]: gated,
          dispose: delegateDispose,
        }),
      );

      const watchersBefore = createdFileSystemWatchers.length;
      const initPromise = project.initialize();
      await waitFor(() => expect(gated.mock.calls.length).toBe(1));
      await project.dispose();
      expect(() => project.getFusionCli()).toThrow();
      releaseGate();
      await initPromise;

      expect(delegateDispose).toHaveBeenCalled();
      expect(() => project.getFusionCli()).toThrow();
      expect(createdFileSystemWatchers.slice(watchersBefore)).toEqual([]);
    },
  );
});
