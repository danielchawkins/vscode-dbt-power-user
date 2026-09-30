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
import {
  ChildrenParentParser,
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
  QueryExecution,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../../dbt_integration";
import { FusionCli } from "../../fusion/fusionCli";
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
  overrides: Partial<FusionCli> = {},
): FusionCli {
  const stub: Partial<FusionCli> = {
    refreshProjectConfig: jest.fn(async () => undefined),
    rebuildManifest: jest.fn(async () => undefined),
    dispose: jest.fn(),
    getDiagnostics: () => ({
      projectConfigDiagnostics: [],
      rebuildManifestDiagnostics: [],
    }),
    getProjectName: () => "single_project",
    getModelPaths: () => [path.join(projectRoot, "models")],
    getMacroPaths: () => [path.join(projectRoot, "macros")],
    getSeedPaths: () => [path.join(projectRoot, "seeds")],
    getTargetPath: () => path.join(projectRoot, "target"),
    ...overrides,
  };
  return stub as FusionCli;
}

async function buildIntegration(
  projectRoot: string,
  fusionDelegate: FusionCli,
): Promise<FusionProjectIntegration> {
  const terminal = mockTerminal();
  const integration = new FusionProjectIntegration(
    {
      resolve: jest.fn(async () => ({
        path: "/mock/bin/dbt",
        version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
        env: process.env as Record<string, string>,
      })),
    },
    () => fusionDelegate,
    projectRoot,
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
    new ModelDepthParser(terminal),
    new SemanticModelParser(terminal),
  );
  await integration.initialize();
  return integration;
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

  it("reads the adapter type from manifest metadata, unknown before a manifest", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-adapter-"));
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
    const targetDir = path.join(tempRoot, "target");
    const integration = await buildIntegration(
      tempRoot,
      stubDelegate(tempRoot, {
        getTargetPath: () => targetDir,
        getPackageInstallPath: () => path.join(tempRoot, "dbt_packages"),
      }),
    );
    expect(integration.getAdapterType()).toBe("unknown");

    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, "manifest.contract.json"), "utf8"),
    );
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, "manifest.json"),
      JSON.stringify({ ...manifest, metadata: { adapter_type: "duckdb" } }),
    );
    await integration.parseManifest();

    expect(integration.getAdapterType()).toBe("duckdb");

    const { metadata: _metadata, ...withoutMetadata } = manifest;
    fs.writeFileSync(
      path.join(targetDir, "manifest.json"),
      JSON.stringify(withoutMetadata),
    );
    await integration.parseManifest();
    expect(integration.getAdapterType()).toBe("duckdb");
    await integration.dispose();
  });

  describe("query column types", () => {
    function fabricatedExecuteSQL(): jest.Mock<() => Promise<QueryExecution>> {
      // Mirrors the published integration's real dbt show --output json shape: real row
      // values, but column_types fabricated as the literal string "string" for every column.
      return jest.fn(
        async () =>
          new QueryExecution(
            async () => undefined,
            async () => ({
              table: {
                column_names: ["a", "b"],
                column_types: ["string", "string"],
                rows: [[1, "x"]],
              },
              compiled_sql: "select 1 as a, 'x' as b",
              raw_sql: "select 1 as a, 'x' as b",
              modelName: "my_model",
            }),
          ),
      );
    }

    it("reports every column type as unknown for executeSQLWithLimit", async () => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-show-"));
      const executeSQL = fabricatedExecuteSQL();
      const integration = await buildIntegration(
        tempRoot,
        stubDelegate(tempRoot, { executeSQL }),
      );

      const execution = await integration.executeSQLWithLimit(
        "select 1 as a, 'x' as b",
        "my_model",
        500,
      );
      const result = await execution.executeQuery();

      expect(executeSQL).toHaveBeenCalled();
      expect(result.table.column_types).toEqual([null, null]);
      expect(result.table.column_names).toEqual(["a", "b"]);
      await integration.dispose();
    });

    it("reports every column type as unknown for immediatelyExecuteSQLWithLimit", async () => {
      tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "fusion-show-immediate-"),
      );
      const integration = await buildIntegration(
        tempRoot,
        stubDelegate(tempRoot, { executeSQL: fabricatedExecuteSQL() }),
      );

      const result = await integration.immediatelyExecuteSQLWithLimit(
        "select 1 as a, 'x' as b",
        "my_model",
        500,
      );

      expect(result.columnTypes).toEqual([null, null]);
      await integration.dispose();
    });

    it("forwards cancellation to the underlying query execution", async () => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-show-cancel-"));
      const cancel = jest.fn(async () => undefined);
      const integration = await buildIntegration(
        tempRoot,
        stubDelegate(tempRoot, {
          executeSQL: jest.fn(
            async () =>
              new QueryExecution(cancel, async () => {
                throw new Error("should not execute after cancel in this test");
              }),
          ),
        }),
      );

      const execution = await integration.executeSQLWithLimit(
        "select 1",
        "my_model",
        500,
      );
      await execution.cancel();

      expect(cancel).toHaveBeenCalled();
      await integration.dispose();
    });
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
    return new FusionProjectIntegrationClass(
      {
        resolve: jest.fn(async () => ({
          path: "/mock/bin/dbt",
          version: { major: 2, minor: 0, patch: 5, raw: "dbt 2.0.5\n" },
          env: process.env as Record<string, string>,
        })),
      },
      (_executable, root) =>
        ({
          refreshProjectConfig: jest.fn(async () => undefined),
          rebuildManifest: mockRebuildManifest,
          getProjectName: () => "single_project",
          getModelPaths: () => [path.join(root, "models")],
          getMacroPaths: () => [path.join(root, "macros")],
          getSeedPaths: () => [path.join(root, "seeds")],
          getTargetPath: () => path.join(root, "target"),
          getDiagnostics: () => ({
            projectConfigDiagnostics: [],
            rebuildManifestDiagnostics: [],
          }),
          dispose: jest.fn(),
        }) as Partial<FusionCli> as FusionCli,
      projectRoot,
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
      new ModelDepthParser(terminal),
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
