import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
  DBTCommand,
  DBTCommandFactory,
  DBTProjectIntegration,
  DBTTerminal,
} from "@altimateai/dbt-integration";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConfigurationChangeEvent, Uri, workspace } from "vscode";
import { createFusionCommandIntegrationFactory } from "../../dbt_client/configuredFusionCommandIntegration";
import {
  FusionCommandIntegrationFactory,
  FusionProjectIntegration,
  FusionProjectIntegrationEvents,
} from "../../dbt_client/fusionProjectIntegration";
import {
  DBT_PATH_SETTING,
  FusionExecutable,
} from "../../fusion/fusionExecutable";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";

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
    complete: jest.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    completeWithTerminalOutput: jest.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    })),
    dispose: jest.fn(),
  } as unknown as CommandProcessExecution;
  const factory = {
    createCommandProcessExecution: jest.fn(
      (options: Record<string, unknown>) => {
        calls.push(options);
        return execution;
      },
    ),
  } as unknown as CommandProcessExecutionFactory;
  return { factory, calls };
}

function stubDelegate(
  root: string,
  hooks: Partial<DBTProjectIntegration> = {},
): DBTProjectIntegration {
  return {
    initializeProject: jest.fn(async () => undefined),
    refreshProjectConfig: jest.fn(async () => undefined),
    rebuildManifest: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
    getDiagnostics: () => ({
      projectConfigDiagnostics: [],
      rebuildManifestDiagnostics: [],
      pythonBridgeDiagnostics: [],
    }),
    getDebounceForRebuildManifest: () => 500,
    getProjectName: () => "cli_test",
    getModelPaths: () => [path.join(root, "models")],
    getMacroPaths: () => [path.join(root, "macros")],
    getSeedPaths: () => [path.join(root, "seeds")],
    getTargetPath: () => path.join(root, "target"),
    executeCommandImmediately: jest.fn(async () => ({
      stdout: "",
      stderr: "",
    })),
    ...hooks,
  } as unknown as DBTProjectIntegration;
}

function lifecycleFactory(
  root: string,
  hooks: Partial<DBTProjectIntegration>,
): FusionCommandIntegrationFactory {
  return () => stubDelegate(root, hooks);
}

function buildIntegration(
  projectRoot: string,
  resolve: () => Promise<
    FusionExecutable | { kind: "notFound"; path: string; source: "configured" }
  >,
  fusionIntegrationFactory: FusionCommandIntegrationFactory,
): FusionProjectIntegration {
  const terminal = mockTerminal();
  return new FusionProjectIntegration(
    { getInstallDepsOnProjectInitialization: () => false } as never,
    {} as DBTCommandFactory,
    { resolve: jest.fn(async () => resolve()) },
    fusionIntegrationFactory,
    projectRoot,
    undefined,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    terminal,
    {} as never,
    {} as never,
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
    jest
      .spyOn(workspace, "onDidChangeConfiguration")
      .mockImplementation((listener) => {
        configListeners.push(
          listener as (event: ConfigurationChangeEvent) => void,
        );
        return { dispose: jest.fn() };
      });
  });

  afterEach(() => {
    delete process.env[ENV_MARKER];
    jest.restoreAllMocks();
  });

  function productionFactory(
    projectRoot: string,
    terminal: DBTTerminal,
    commandProcessExecutionFactory: CommandProcessExecutionFactory,
  ): FusionCommandIntegrationFactory {
    const base = createFusionCommandIntegrationFactory(
      commandProcessExecutionFactory,
      {} as DBTCommandFactory,
      terminal,
    );
    return (...args) => {
      const delegate = base(...args);
      jest.spyOn(delegate, "refreshProjectConfig").mockResolvedValue(undefined);
      jest.spyOn(delegate, "rebuildManifest").mockResolvedValue(undefined);
      jest
        .spyOn(delegate, "getModelPaths")
        .mockReturnValue([path.join(projectRoot, "models")]);
      jest
        .spyOn(delegate, "getMacroPaths")
        .mockReturnValue([path.join(projectRoot, "macros")]);
      jest
        .spyOn(delegate, "getSeedPaths")
        .mockReturnValue([path.join(projectRoot, "seeds")]);
      jest
        .spyOn(delegate, "getTargetPath")
        .mockReturnValue(path.join(projectRoot, "target"));
      return delegate;
    };
  }

  it("executes CLI with per-project path, cwd, and env isolation", async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-a-"));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-b-"));
    prepareProjectRoot(rootA);
    prepareProjectRoot(rootB);
    const envA = { ...process.env, [ENV_MARKER]: "a" } as Record<
      string,
      string
    >;
    const envB = { ...process.env, [ENV_MARKER]: "b" } as Record<
      string,
      string
    >;
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

    const command = new DBTCommand(
      "version",
      ["--version"],
      false,
      true,
      false,
    );
    await integrationA
      .getCurrentProjectIntegration()
      .executeCommandImmediately(command);
    await integrationB
      .getCurrentProjectIntegration()
      .executeCommandImmediately(command);

    expect(recordingA.calls[0]).toMatchObject({
      command: "/project/a/bin/dbt",
      cwd: rootA,
      envVars: envA,
    });
    expect(recordingB.calls[0]).toMatchObject({
      command: "/project/b/bin/dbt",
      cwd: rootB,
      envVars: envB,
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
    expect(integration.getDiagnostics().projectConfigDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "fusion-executable",
          severity: "error",
        }),
      ]),
    );
    expect(() => integration.getCurrentProjectIntegration()).toThrow(
      /not initialized/,
    );

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("re-resolves on scoped path change, keeps sibling path/env, and executes B after A refresh", async () => {
    const rootA = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-refresh-a-"),
    );
    const rootB = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-refresh-b-"),
    );
    prepareProjectRoot(rootA);
    prepareProjectRoot(rootB);
    const envB = { ...process.env, [ENV_MARKER]: "b" } as Record<
      string,
      string
    >;
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
    expect(() => integrationA.getCurrentProjectIntegration()).toThrow();

    pathA = "/project/a/recovered/dbt";
    for (const listener of configListeners) {
      listener(pathChangeEvent(rootA));
    }
    await waitFor(() => integrationA.getCurrentProjectIntegration());

    await integrationA
      .getCurrentProjectIntegration()
      .executeCommandImmediately(
        new DBTCommand("version", ["--version"], false, true, false),
      );
    await integrationB
      .getCurrentProjectIntegration()
      .executeCommandImmediately(
        new DBTCommand("version", ["--version"], false, true, false),
      );

    expect(recordingA.calls[0]).toMatchObject({
      command: "/project/a/recovered/dbt",
      cwd: rootA,
    });
    expect(recordingB.calls[0]).toMatchObject({
      command: "/project/b/bin/dbt",
      cwd: rootB,
      envVars: envB,
    });

    await integrationA.dispose();
    await integrationB.dispose();
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("applies the last scoped fusionPath refresh when several arrive back-to-back", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-cli-last-"));
    prepareProjectRoot(root);
    let configuredPath = "/project/a/v1/dbt";
    const recording = recordingExecutionFactory();
    const terminal = mockTerminal();
    const resolve = jest.fn(async () => sampleExecutable(configuredPath));
    const integration = buildIntegration(
      root,
      async () => resolve(),
      productionFactory(root, terminal, recording.factory),
    );

    await integration.initialize();
    configuredPath = "/project/a/v2/dbt";
    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }
    configuredPath = "/project/a/v3/dbt";
    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }
    await waitFor(() => expect(resolve.mock.calls.length).toBe(3));
    await waitFor(() => integration.getCurrentProjectIntegration());

    await integration
      .getCurrentProjectIntegration()
      .executeCommandImmediately(
        new DBTCommand("version", ["--version"], false, true, false),
      );
    expect(recording.calls[recording.calls.length - 1]).toMatchObject({
      command: "/project/a/v3/dbt",
      cwd: root,
    });

    await integration.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function drainMicrotasks(rounds = 8): Promise<void> {
    for (let round = 0; round < rounds; round++) {
      await Promise.resolve();
    }
  }

  it("ignores refresh queued before dispose without running its body", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-queue-before-dispose-"),
    );
    prepareProjectRoot(root);
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const initializeProject = jest.fn(async () => {
      await gate;
    });
    const resolve = jest.fn(async () => sampleExecutable("/project/dbt"));
    const factoryCalls = jest.fn();
    const projectConfigChanged = jest.fn();
    const integration = buildIntegration(
      root,
      async () => resolve(),
      (...args) => {
        factoryCalls();
        return stubDelegate(root, { initializeProject });
      },
    );
    integration.on(
      FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED,
      projectConfigChanged,
    );

    const initPromise = integration.initialize();
    await waitFor(() => expect(initializeProject).toHaveBeenCalledTimes(1));

    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }

    await integration.dispose();
    releaseGate();
    await initPromise;
    await drainMicrotasks();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(factoryCalls).toHaveBeenCalledTimes(1);
    expect(initializeProject).toHaveBeenCalledTimes(1);
    expect(() => integration.getCurrentProjectIntegration()).toThrow();
    expect(projectConfigChanged).not.toHaveBeenCalled();
    expect(
      (integration as unknown as { isWatchingSourceFiles: boolean })
        .isWatchingSourceFiles,
    ).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("propagates initialize errors while keeping the refresh chain alive", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "fusion-cli-init-error-"),
    );
    prepareProjectRoot(root);
    let failRebuild = true;
    const rebuildManifest = jest.fn(async () => {
      if (failRebuild) {
        throw new Error("rebuild failed");
      }
    });
    let configuredPath = "/project/v1/dbt";
    const resolve = jest.fn(async () => sampleExecutable(configuredPath));
    const integration = buildIntegration(
      root,
      async () => resolve(),
      lifecycleFactory(root, { rebuildManifest }),
    );

    await expect(integration.initialize()).rejects.toThrow("rebuild failed");
    expect(resolve.mock.calls.length).toBe(1);

    failRebuild = false;
    configuredPath = "/project/v2/dbt";
    for (const listener of configListeners) {
      listener(pathChangeEvent(root));
    }
    await waitFor(() => expect(resolve.mock.calls.length).toBe(2));
    await waitFor(() => integration.getCurrentProjectIntegration());

    await integration.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["initializeProject", "initializeProject"],
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
      const hooks: Partial<DBTProjectIntegration> = {
        [gatedMethod]: jest.fn(async () => {
          await gate;
        }),
      };
      const delegateDispose = jest.fn(async () => undefined);
      const projectConfigChanged = jest.fn();
      const integration = buildIntegration(
        root,
        async () => sampleExecutable("/project/race/dbt"),
        lifecycleFactory(root, {
          ...hooks,
          dispose: delegateDispose,
        }),
      );
      integration.on(
        FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED,
        projectConfigChanged,
      );

      const initPromise = integration.initialize();
      const gatedMock = hooks[gatedMethod] as jest.Mock;
      await waitFor(() => expect(gatedMock.mock.calls.length).toBe(1));
      await integration.dispose();
      releaseGate();
      await initPromise;

      expect(delegateDispose).toHaveBeenCalled();
      expect(() => integration.getCurrentProjectIntegration()).toThrow();
      expect(projectConfigChanged).not.toHaveBeenCalled();
      expect(
        (integration as unknown as { isWatchingSourceFiles: boolean })
          .isWatchingSourceFiles,
      ).toBe(false);

      fs.rmSync(root, { recursive: true, force: true });
    },
  );
});
