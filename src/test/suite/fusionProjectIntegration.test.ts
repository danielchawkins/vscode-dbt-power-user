import {
  ChildrenParentParser,
  DBTCommandFactory,
  DBTConfiguration,
  DBTProjectIntegration,
  DBTTerminal,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  ParsedManifest,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
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
import {
  FusionProjectIntegration,
  FusionProjectIntegrationEvents,
} from "../../dbt_client/fusionProjectIntegration";
import { createLocalModelDepthContext } from "../../manifest/localModelDepthContext";
import { esmDirname } from "../esmDirname";

const fixtureRoot = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/single-project",
);

function mockTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    trace: () => undefined,
    logNewLine: () => undefined,
    logLine: () => undefined,
    logHorizontalRule: () => undefined,
    logBlock: () => undefined,
    logError: () => undefined,
    logWarning: () => undefined,
    logSuccess: () => undefined,
    disposables: [],
    write: () => undefined,
    processQueue: () => Promise.resolve(),
  } as unknown as DBTTerminal;
}

function stubDelegate(
  projectRoot: string,
  overrides: Partial<DBTProjectIntegration> = {},
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
    getProjectName: () => "single_project",
    getModelPaths: () => [path.join(projectRoot, "models")],
    getMacroPaths: () => [path.join(projectRoot, "macros")],
    getSeedPaths: () => [path.join(projectRoot, "seeds")],
    getTargetPath: () => path.join(projectRoot, "target"),
    ...overrides,
  } as unknown as DBTProjectIntegration;
}

async function buildIntegration(
  projectRoot: string,
  fusionDelegate: DBTProjectIntegration,
): Promise<FusionProjectIntegration> {
  const terminal = mockTerminal();
  const configuration = {
    getInstallDepsOnProjectInitialization: () => false,
    getQueryLimit: () => 500,
    getDisableDepthsCalculation: () => false,
  } as unknown as DBTConfiguration;
  const integration = new FusionProjectIntegration(
    configuration,
    {} as DBTCommandFactory,
    {
      resolve: jest.fn(async () => ({
        path: "/mock/bin/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
        env: process.env as Record<string, string>,
      })),
    },
    () => fusionDelegate,
    projectRoot,
    undefined,
    new ChildrenParentParser(),
    new NodeParser(terminal),
    new MacroParser(terminal),
    new MetricParser(terminal),
    new GraphParser(terminal),
    new SourceParser(terminal),
    new TestParser(terminal),
    new UnitTestParser(terminal),
    new ExposureParser(terminal),
    new FunctionParser(terminal),
    new DocParser(terminal),
    terminal,
    new ModelDepthParser(
      terminal,
      createLocalModelDepthContext(),
      configuration,
    ),
    new SemanticModelParser(terminal),
  );
  await integration.initialize();
  return integration;
}

function sampleRunResultsJson(invocationId = "inv-123") {
  return JSON.stringify({
    metadata: {
      invocation_id: invocationId,
      generated_at: "2026-01-01T00:00:00.000000Z",
    },
    args: { which: "run", select: ["my_model"] },
    results: [
      {
        unique_id: "model.single_project.my_model",
        status: "success",
        execution_time: 1.2,
      },
    ],
    elapsed_time: 1.2,
  });
}

function writeRunResults(targetDir: string, content = sampleRunResultsJson()) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "run_results.json"), content);
}

function prepareWatcherPaths(projectRoot: string): void {
  for (const segment of ["models", "macros", "seeds"]) {
    fs.mkdirSync(path.join(projectRoot, segment), { recursive: true });
  }
  const projectFile = path.join(projectRoot, "dbt_project.yml");
  if (!fs.existsSync(projectFile)) {
    fs.writeFileSync(projectFile, "name: single_project\nversion: 1.0.0\n");
  }
}

describe("FusionProjectIntegration", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("emits MANIFEST_PARSED with contract map keys from manifest.json", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-int-"));
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
    const targetDir = path.join(tempRoot, "target");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(
      path.join(fixtureRoot, "manifest.contract.json"),
      path.join(targetDir, "manifest.json"),
    );

    const fusionDelegate = stubDelegate(tempRoot, {
      getTargetPath: () => targetDir,
      getPackageInstallPath: () => path.join(tempRoot, "dbt_packages"),
    });

    const integration = await buildIntegration(tempRoot, fusionDelegate);
    const parsed = await new Promise<ParsedManifest>((resolve) => {
      integration.on(FusionProjectIntegrationEvents.MANIFEST_PARSED, resolve);
      void integration.parseManifest();
    });

    expect([...parsed.nodeMetaMap.nodes()].length).toBeGreaterThan(0);
    expect(parsed.graphMetaMap.parents.size).toBeGreaterThan(0);
    expect(parsed.macroMetaMap.size).toBeGreaterThan(0);
    expect(parsed.modelDepthMap.size).toBeGreaterThan(0);
    await integration.dispose();
  });

  it("parses run_results.json when content appears after command start", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-fresh-"));
    prepareWatcherPaths(tempRoot);
    const targetDir = path.join(tempRoot, "target");
    const integration = await buildIntegration(
      tempRoot,
      stubDelegate(tempRoot, { getTargetPath: () => targetDir }),
    );
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    writeRunResults(targetDir);
    const event = integration.parseRunResultsAfterCommand(before);

    expect(before).toBeNull();
    expect(event?.id).toBe("inv-123");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-123", projectName: "single_project" }),
    );
    await integration.dispose();
  });

  it("ignores unchanged run_results.json after command start", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-stale-"));
    prepareWatcherPaths(tempRoot);
    const targetDir = path.join(tempRoot, "target");
    writeRunResults(targetDir);
    const integration = await buildIntegration(
      tempRoot,
      stubDelegate(tempRoot, { getTargetPath: () => targetDir }),
    );
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    expect(integration.parseRunResultsAfterCommand(before)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    await integration.dispose();
  });

  it("stays silent when run_results.json is missing after command start", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-missing-"));
    prepareWatcherPaths(tempRoot);
    const targetDir = path.join(tempRoot, "target");
    const integration = await buildIntegration(
      tempRoot,
      stubDelegate(tempRoot, { getTargetPath: () => targetDir }),
    );
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    expect(integration.parseRunResultsAfterCommand(before)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    await integration.dispose();
  });

  it("parses run_results.json when content changes after command start", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-changed-"));
    prepareWatcherPaths(tempRoot);
    const targetDir = path.join(tempRoot, "target");
    writeRunResults(targetDir, sampleRunResultsJson("inv-old"));
    const integration = await buildIntegration(
      tempRoot,
      stubDelegate(tempRoot, { getTargetPath: () => targetDir }),
    );
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    writeRunResults(targetDir, sampleRunResultsJson("inv-new"));
    const event = integration.parseRunResultsAfterCommand(before);

    expect(event?.id).toBe("inv-new");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-new" }),
    );
    await integration.dispose();
  });
});

describe("FusionProjectIntegration file watchers", () => {
  let tempRoot: string;
  let watchMock: jest.Mock;
  let FusionProjectIntegrationClass: typeof FusionProjectIntegration;
  let mockRebuildManifest: jest.Mock<() => Promise<void>>;
  let usingFakeTimers = false;

  beforeEach(async () => {
    mockRebuildManifest = jest.fn(async () => undefined);
    watchMock = jest.fn();
    jest.resetModules();
    await jest.unstable_mockModule("fs", () => {
      const actual = jest.requireActual("fs") as typeof import("fs");
      return {
        ...actual,
        watch: watchMock,
      };
    });
    ({ FusionProjectIntegration: FusionProjectIntegrationClass } =
      await import("../../dbt_client/fusionProjectIntegration"));
  });

  afterEach(async () => {
    if (usingFakeTimers) {
      jest.useRealTimers();
      usingFakeTimers = false;
    }
    jest.restoreAllMocks();
    jest.resetModules();
    await jest.unstable_unmockModule("fs");
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function buildMockedIntegration(projectRoot: string) {
    const terminal = mockTerminal();
    const configuration = {
      getInstallDepsOnProjectInitialization: () => false,
      getQueryLimit: () => 500,
      getDisableDepthsCalculation: () => false,
    } as unknown as DBTConfiguration;
    return new FusionProjectIntegrationClass(
      configuration,
      {} as DBTCommandFactory,
      {
        resolve: jest.fn(async () => ({
          path: "/mock/bin/dbt",
          version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
          env: process.env as Record<string, string>,
        })),
      },
      (_executable, root) =>
        ({
          initializeProject: jest.fn(async () => undefined),
          refreshProjectConfig: jest.fn(async () => undefined),
          rebuildManifest: mockRebuildManifest,
          getProjectName: () => "single_project",
          getModelPaths: () => [path.join(root, "models")],
          getMacroPaths: () => [path.join(root, "macros")],
          getSeedPaths: () => [path.join(root, "seeds")],
          getTargetPath: () => path.join(root, "target"),
          getDebounceForRebuildManifest: () => 500,
          getDiagnostics: () => ({
            projectConfigDiagnostics: [],
            rebuildManifestDiagnostics: [],
            pythonBridgeDiagnostics: [],
          }),
          dispose: jest.fn(async () => undefined),
        }) as unknown as DBTProjectIntegration,
      projectRoot,
      undefined,
      new ChildrenParentParser(),
      new NodeParser(terminal),
      new MacroParser(terminal),
      new MetricParser(terminal),
      new GraphParser(terminal),
      new SourceParser(terminal),
      new TestParser(terminal),
      new UnitTestParser(terminal),
      new ExposureParser(terminal),
      new FunctionParser(terminal),
      new DocParser(terminal),
      terminal,
      new ModelDepthParser(
        terminal,
        createLocalModelDepthContext(),
        configuration,
      ),
      new SemanticModelParser(terminal),
    );
  }

  it("watches model, macro, seed, and dbt_project.yml paths only via initialize", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-watch-"));
    fs.mkdirSync(path.join(tempRoot, "models"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "macros"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "seeds"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "target"), { recursive: true });

    const closeMock = jest.fn();
    watchMock.mockReturnValue({ close: closeMock } as unknown as fs.FSWatcher);

    const integration = buildMockedIntegration(tempRoot);
    await integration.initialize();

    const watchedPaths = watchMock.mock.calls.map(([watchedPath]) =>
      String(watchedPath),
    );
    expect(watchedPaths).toEqual(
      expect.arrayContaining([
        path.join(tempRoot, "models"),
        path.join(tempRoot, "macros"),
        path.join(tempRoot, "seeds"),
        path.join(tempRoot, "dbt_project.yml"),
      ]),
    );
    expect(
      watchedPaths.some((watchedPath) => watchedPath.includes("target")),
    ).toBe(false);

    await integration.dispose();
    expect(closeMock).toHaveBeenCalledTimes(4);

    watchMock.mockClear();
    closeMock.mockClear();
    const reinitialized = buildMockedIntegration(tempRoot);
    await reinitialized.initialize();
    expect(watchMock).toHaveBeenCalledTimes(4);
    await reinitialized.dispose();
    expect(closeMock).toHaveBeenCalledTimes(4);
  });

  it("cancels pending source debounce timers on dispose", async () => {
    usingFakeTimers = true;
    jest.useFakeTimers();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-debounce-"));
    fs.mkdirSync(path.join(tempRoot, "models"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "macros"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "seeds"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "target"), { recursive: true });

    let changeHandler: ((event: string, filename?: string) => void) | undefined;
    watchMock.mockImplementation((...args: unknown[]) => {
      const listener = args.find((arg) => typeof arg === "function") as
        ((event: string, filename?: string) => void) | undefined;
      if (listener) {
        changeHandler = listener;
      }
      return { close: jest.fn() } as unknown as fs.FSWatcher;
    });

    const integration = buildMockedIntegration(tempRoot);
    await integration.initialize();
    changeHandler?.("change", "model.sql");
    jest.advanceTimersByTime(400);
    await integration.dispose();
    jest.advanceTimersByTime(500);
    expect(mockRebuildManifest).toHaveBeenCalledTimes(1);
  });
});
