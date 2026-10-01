import * as fs from "fs";
import * as os from "os";
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
import {
  ConfigurationChangeEvent,
  DiagnosticSeverity,
  Uri,
  window,
  workspace,
} from "vscode";
import { DBTTerminal } from "../../dbt_integration";
import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
} from "../../fusion/commandProcessExecution";
import { FusionCommandIntegrationFactory } from "../../fusion/executableLifecycle";
import { FusionCli } from "../../fusion/fusionCli";
import {
  DBT_PATH_SETTING,
  FusionExecutable,
} from "../../fusion/fusionExecutable";
import { Project } from "../../projects/project";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { CONFIGURATION_SECTION } from "../../settings";
import { createdFileSystemWatchers } from "../mock/vscode";
import { buildTestProject } from "../projectHarness";

const ENV_MARKER = "FUSION_PU_CLI_ENV";

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

function prepareProjectRoot(root: string): void {
  fs.mkdirSync(path.join(root, "models"), { recursive: true });
  fs.mkdirSync(path.join(root, "macros"), { recursive: true });
  fs.mkdirSync(path.join(root, "seeds"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "dbt_project.yml"),
    "name: cli_test\nversion: 1.0.0\n",
  );
}

function sampleExecutable(
  executablePath: string,
  env: Record<string, string> = process.env as Record<string, string>,
): FusionExecutable {
  return {
    path: executablePath,
    version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
    env,
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
    show: async () => undefined,
    dispose: () => undefined,
  } as unknown as DBTTerminal;
}

function recordingExecutionFactory(): {
  factory: CommandProcessExecutionFactory;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const execution = {
    complete: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    dispose: vi.fn(),
  } as unknown as CommandProcessExecution;
  const factory = {
    createCommandProcessExecution: vi.fn((options: Record<string, unknown>) => {
      calls.push(options);
      return execution;
    }),
  } as unknown as CommandProcessExecutionFactory;
  return { factory, calls };
}

function stubDelegate(root: string, hooks: Partial<FusionCli> = {}): FusionCli {
  const stub: Partial<FusionCli> = {
    refreshProjectConfig: vi.fn(async () => undefined),
    rebuildManifest: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    getDiagnostics: () => ({
      projectConfigDiagnostics: [],
      rebuildManifestDiagnostics: [],
    }),
    getProjectName: () => "cli_test",
    getModelPaths: () => [path.join(root, "models")],
    getMacroPaths: () => [path.join(root, "macros")],
    getSeedPaths: () => [path.join(root, "seeds")],
    getTargetPath: () => path.join(root, "target"),
    run: vi.fn(async () => ({ stdout: "", stderr: "", fullOutput: "" })),
    ...hooks,
  };
  return stub as FusionCli;
}

function lifecycleFactory(
  root: string,
  hooks: Partial<FusionCli>,
): FusionCommandIntegrationFactory {
  return () => stubDelegate(root, hooks);
}

function buildIntegration(
  projectRoot: string,
  resolve: () => Promise<
    FusionExecutable | { kind: "notFound"; path: string; source: "configured" }
  >,
  fusionIntegrationFactory: FusionCommandIntegrationFactory,
): Project {
  return buildTestProject(projectRoot, fusionIntegrationFactory, {
    resolver: { resolve: vi.fn(async () => resolve()) },
    terminal: mockTerminal(),
  });
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

function pathChangeEvent(root: string): ConfigurationChangeEvent {
  return {
    affectsConfiguration: (section: string, scope?: Uri) =>
      section === `${CONFIGURATION_SECTION}.${DBT_PATH_SETTING}` &&
      scope?.fsPath === root,
  } as ConfigurationChangeEvent;
}

describe("Fusion CLI executable wiring", () => {
  let configListeners: Array<(event: ConfigurationChangeEvent) => void>;

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
    delete process.env[ENV_MARKER];
    vi.restoreAllMocks();
  });

  function fusionCliFactory(
    terminal: DBTTerminal,
    commandProcessExecutionFactory: CommandProcessExecutionFactory,
  ): FusionCommandIntegrationFactory {
    return (executable, root) =>
      new FusionCli(
        executable,
        () => readProjectSnapshot(Uri.file(root)),
        commandProcessExecutionFactory,
        terminal,
      );
  }

  function productionFactory(
    _projectRoot: string,
    terminal: DBTTerminal,
    commandProcessExecutionFactory: CommandProcessExecutionFactory,
  ): FusionCommandIntegrationFactory {
    const base = fusionCliFactory(terminal, commandProcessExecutionFactory);
    return (...args) => {
      const delegate = base(...args);
      vi.spyOn(delegate, "rebuildManifest").mockResolvedValue(undefined);
      return delegate;
    };
  }

  it("spawns only dbt parse when a project activates", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-activate-"));
    prepareProjectRoot(root);
    const recording = recordingExecutionFactory();
    const integration = buildIntegration(
      root,
      async () => sampleExecutable("/bin/dbt"),
      fusionCliFactory(mockTerminal(), recording.factory),
    );

    await integration.initialize();

    const subcommands = recording.calls.map(
      (call) => (call.args as string[])[0],
    );
    expect(subcommands).toEqual(["parse"]);
    await integration.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("executes CLI with per-project path and cwd, and the snapshot environment", async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-a-"));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-b-"));
    prepareProjectRoot(rootA);
    prepareProjectRoot(rootB);
    const envA = { [ENV_MARKER]: "executable-a" };
    const envB = { [ENV_MARKER]: "executable-b" };
    process.env[ENV_MARKER] = "host";
    const recordingA = recordingExecutionFactory();
    const recordingB = recordingExecutionFactory();
    const terminal = mockTerminal();

    const integrationA = buildIntegration(
      rootA,
      async () => sampleExecutable("/project/a/bin/dbt", envA),
      productionFactory(rootA, terminal, recordingA.factory),
    );
    const integrationB = buildIntegration(
      rootB,
      async () => sampleExecutable("/project/b/bin/dbt", envB),
      productionFactory(rootB, terminal, recordingB.factory),
    );

    await integrationA.initialize();
    await integrationB.initialize();

    await integrationA.getFusionCli().run({ kind: "deps" });
    await integrationB.getFusionCli().run({ kind: "deps" });

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

    await integrationA.dispose();
    await integrationB.dispose();
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("records resolution failure diagnostics without initializing delegate", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-fail-"));
    prepareProjectRoot(root);
    const terminal = mockTerminal();
    const integration = buildIntegration(
      root,
      async () => ({
        kind: "notFound",
        path: "/missing/dbt",
        source: "configured",
      }),
      productionFactory(root, terminal, recordingExecutionFactory().factory),
    );

    await integration.initialize();
    expect(executableErrors(integration)).toHaveLength(1);
    expect(() => integration.getFusionCli()).toThrow(/not initialized/);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps a healthy sibling initializing when one project's resolver fails, without notifying the user", async () => {
    const failedRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-sibling-failed-"),
    );
    const healthyRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-sibling-healthy-"),
    );
    prepareProjectRoot(failedRoot);
    prepareProjectRoot(healthyRoot);

    const failedIntegration = buildIntegration(
      failedRoot,
      async () => ({
        kind: "notFound",
        path: "/missing/dbt",
        source: "configured",
      }),
      lifecycleFactory(failedRoot, {}),
    );
    const refreshProjectConfig = vi.fn(async () => undefined);
    const healthyIntegration = buildIntegration(
      healthyRoot,
      async () => sampleExecutable("/opt/healthy/dbt"),
      lifecycleFactory(healthyRoot, { refreshProjectConfig }),
    );

    await Promise.all([
      failedIntegration.initialize(),
      healthyIntegration.initialize(),
    ]);

    expect(executableErrors(failedIntegration)).toHaveLength(1);
    expect(() => failedIntegration.getFusionCli()).toThrow(/not initialized/);
    expect(healthyIntegration.getFusionCli()).toBeDefined();
    expect(refreshProjectConfig).toHaveBeenCalledTimes(1);
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();

    await failedIntegration.dispose();
    await healthyIntegration.dispose();
    fs.rmSync(failedRoot, { recursive: true, force: true });
    fs.rmSync(healthyRoot, { recursive: true, force: true });
  });

  it("re-resolves on scoped path change, keeps sibling path, and executes B after A refresh", async () => {
    const rootA = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-refresh-a-"),
    );
    const rootB = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-refresh-b-"),
    );
    prepareProjectRoot(rootA);
    prepareProjectRoot(rootB);
    const envB = { [ENV_MARKER]: "executable-b" };
    let pathA = "/missing/a/dbt";
    const recordingA = recordingExecutionFactory();
    const recordingB = recordingExecutionFactory();
    const terminal = mockTerminal();

    const integrationA = buildIntegration(
      rootA,
      async () =>
        pathA.startsWith("/missing")
          ? { kind: "notFound", path: pathA, source: "configured" }
          : sampleExecutable(pathA),
      productionFactory(rootA, terminal, recordingA.factory),
    );
    const integrationB = buildIntegration(
      rootB,
      async () => sampleExecutable("/project/b/bin/dbt", envB),
      productionFactory(rootB, terminal, recordingB.factory),
    );

    await integrationA.initialize();
    await integrationB.initialize();
    expect(() => integrationA.getFusionCli()).toThrow();

    pathA = "/project/a/recovered/dbt";
    for (const listener of configListeners) {
      listener(pathChangeEvent(rootA));
    }
    await waitFor(() => integrationA.getFusionCli());

    await integrationA.getFusionCli().run({ kind: "deps" });
    await integrationB.getFusionCli().run({ kind: "deps" });

    expect(recordingA.calls[0]).toMatchObject({
      command: "/project/a/recovered/dbt",
      cwd: rootA,
    });
    expect(recordingB.calls[0]).toMatchObject({
      command: "/project/b/bin/dbt",
      cwd: rootB,
    });

    await integrationA.dispose();
    await integrationB.dispose();
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("clears the previous executable's rebuild diagnostics when re-resolution fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-stale-"));
    prepareProjectRoot(root);
    let missing = false;
    const integration = buildIntegration(
      root,
      async () =>
        missing
          ? { kind: "notFound", path: "/missing/dbt", source: "configured" }
          : sampleExecutable("/bin/dbt"),
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
    await integration.initialize();
    integration.updateDiagnosticsInProblemsPanel();
    expect(integration.getAllDiagnostic().map((d) => d.code)).toEqual([
      "rebuild-manifest",
    ]);

    missing = true;
    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }
    await waitFor(() => expect(executableErrors(integration)).toHaveLength(1));

    expect(integration.getAllDiagnostic().map((d) => d.code)).toEqual([
      "fusion-executable",
    ]);
    await integration.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["refreshProjectConfig", "refreshProjectConfig"],
    ["rebuildManifest", "rebuildManifest"],
  ] as const)(
    "does not commit delegate or watchers when disposed during %s",
    async (_label, gatedMethod) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), `fusion-cli-race-${gatedMethod}-`),
      );
      prepareProjectRoot(root);
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      const hooks: Partial<FusionCli> = {
        [gatedMethod]: vi.fn(async () => {
          await gate;
        }),
      };
      const delegateDispose = vi.fn(async () => undefined);
      const projectConfigChanged = vi.fn();
      const integration = buildIntegration(
        root,
        async () => sampleExecutable("/project/race/dbt"),
        lifecycleFactory(root, {
          ...hooks,
          dispose: delegateDispose as () => void,
        }),
      );
      integration.onProjectConfigChanged(projectConfigChanged);

      const watchersBefore = createdFileSystemWatchers.length;
      const initPromise = integration.initialize();
      const gatedMock = hooks[gatedMethod] as Mock;
      await waitFor(() => expect(gatedMock.mock.calls.length).toBe(1));
      await integration.dispose();
      expect(() => integration.getFusionCli()).toThrow();
      releaseGate();
      await initPromise;

      expect(delegateDispose).toHaveBeenCalled();
      expect(() => integration.getFusionCli()).toThrow();
      expect(projectConfigChanged).not.toHaveBeenCalled();
      expect(createdFileSystemWatchers.slice(watchersBefore)).toEqual([]);

      fs.rmSync(root, { recursive: true, force: true });
    },
  );
});
