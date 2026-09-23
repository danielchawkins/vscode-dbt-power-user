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

function buildIntegration(
  projectRoot: string,
  fusionDelegate: DBTProjectIntegration,
): FusionProjectIntegration {
  const terminal = mockTerminal();
  const configuration = {
    getInstallDepsOnProjectInitialization: () => false,
    getQueryLimit: () => 500,
    getDisableDepthsCalculation: () => false,
  } as unknown as DBTConfiguration;
  return new FusionProjectIntegration(
    configuration,
    {} as DBTCommandFactory,
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

    const fusionDelegate = {
      getProjectName: () => "single_project",
      getTargetPath: () => targetDir,
      getPackageInstallPath: () => path.join(tempRoot, "dbt_packages"),
      getModelPaths: () => [path.join(tempRoot, "models")],
      getSeedPaths: () => [path.join(tempRoot, "seeds")],
      getMacroPaths: () => [path.join(tempRoot, "macros")],
      getDebounceForRebuildManifest: () => 500,
      dispose: () => undefined,
    } as unknown as DBTProjectIntegration;

    const integration = buildIntegration(tempRoot, fusionDelegate);
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

  it("parses run_results.json when content appears after command start", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-fresh-"));
    const targetDir = path.join(tempRoot, "target");
    const integration = buildIntegration(tempRoot, {
      getProjectName: () => "single_project",
      getTargetPath: () => targetDir,
    } as unknown as DBTProjectIntegration);
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
  });

  it("ignores unchanged run_results.json after command start", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-stale-"));
    const targetDir = path.join(tempRoot, "target");
    writeRunResults(targetDir);
    const integration = buildIntegration(tempRoot, {
      getProjectName: () => "single_project",
      getTargetPath: () => targetDir,
    } as unknown as DBTProjectIntegration);
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    expect(integration.parseRunResultsAfterCommand(before)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it("stays silent when run_results.json is missing after command start", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-missing-"));
    const targetDir = path.join(tempRoot, "target");
    const integration = buildIntegration(tempRoot, {
      getProjectName: () => "single_project",
      getTargetPath: () => targetDir,
    } as unknown as DBTProjectIntegration);
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    expect(integration.parseRunResultsAfterCommand(before)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it("parses run_results.json when content changes after command start", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-run-changed-"));
    const targetDir = path.join(tempRoot, "target");
    writeRunResults(targetDir, sampleRunResultsJson("inv-old"));
    const integration = buildIntegration(tempRoot, {
      getProjectName: () => "single_project",
      getTargetPath: () => targetDir,
    } as unknown as DBTProjectIntegration);
    const listener = jest.fn();
    integration.on(FusionProjectIntegrationEvents.RUN_RESULTS_PARSED, listener);

    const before = integration.observeRunResultsBeforeCommand();
    writeRunResults(targetDir, sampleRunResultsJson("inv-new"));
    const event = integration.parseRunResultsAfterCommand(before);

    expect(event?.id).toBe("inv-new");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-new" }),
    );
  });
});

describe("FusionProjectIntegration file watchers", () => {
  let tempRoot: string;
  let watchMock: jest.Mock;
  let FusionProjectIntegrationClass: typeof FusionProjectIntegration;
  let usingFakeTimers = false;

  beforeEach(async () => {
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
    jest.resetModules();
    await jest.unstable_unmockModule("fs");
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function buildMockedIntegration(
    projectRoot: string,
    fusionDelegate: DBTProjectIntegration,
  ) {
    const terminal = mockTerminal();
    const configuration = {
      getInstallDepsOnProjectInitialization: () => false,
      getQueryLimit: () => 500,
      getDisableDepthsCalculation: () => false,
    } as unknown as DBTConfiguration;
    return new FusionProjectIntegrationClass(
      configuration,
      {} as DBTCommandFactory,
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
  }

  function buildWatcherDelegate(
    projectRoot: string,
    rebuildManifest = jest.fn(() => Promise.resolve()),
  ) {
    return {
      initializeProject: jest.fn(() => Promise.resolve()),
      refreshProjectConfig: jest.fn(() => Promise.resolve()),
      rebuildManifest,
      getProjectName: () => "single_project",
      getModelPaths: () => [path.join(projectRoot, "models")],
      getMacroPaths: () => [path.join(projectRoot, "macros")],
      getSeedPaths: () => [path.join(projectRoot, "seeds")],
      getTargetPath: () => path.join(projectRoot, "target"),
      getDebounceForRebuildManifest: () => 500,
      dispose: jest.fn(() => Promise.resolve()),
    } as unknown as DBTProjectIntegration;
  }

  it("watches model, macro, seed, and dbt_project.yml paths only via initialize", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-watch-"));
    fs.mkdirSync(path.join(tempRoot, "models"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "macros"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "seeds"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "target"), { recursive: true });

    const closeMock = jest.fn();
    watchMock.mockReturnValue({ close: closeMock } as unknown as fs.FSWatcher);

    const integration = buildMockedIntegration(
      tempRoot,
      buildWatcherDelegate(tempRoot),
    );
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
    await integration.initialize();
    expect(watchMock).toHaveBeenCalledTimes(4);
    await integration.dispose();
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

    const rebuildManifest = jest.fn(() => Promise.resolve());
    const integration = buildMockedIntegration(
      tempRoot,
      buildWatcherDelegate(tempRoot, rebuildManifest),
    );
    await integration.initialize();
    changeHandler?.("change", "model.sql");
    jest.advanceTimersByTime(400);
    await integration.dispose();
    jest.advanceTimersByTime(500);
    expect(rebuildManifest).toHaveBeenCalledTimes(1);
  });
});
