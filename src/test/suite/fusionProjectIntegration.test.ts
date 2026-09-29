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
import {
  createdFileSystemWatchers,
  type MockFileSystemWatcher,
} from "../mock/vscode";

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

describe("FusionProjectIntegration manifest trigger", () => {
  const root = "/project";
  let rebuildManifest: jest.Mock<() => Promise<void>>;
  let refreshProjectConfig: jest.Mock<() => Promise<void>>;
  let integration: FusionProjectIntegration;
  let watcher: MockFileSystemWatcher;

  beforeEach(async () => {
    jest.useFakeTimers();
    createdFileSystemWatchers.length = 0;
    rebuildManifest = jest.fn(async () => undefined);
    refreshProjectConfig = jest.fn(async () => undefined);
    integration = await buildIntegration(
      root,
      stubDelegate(root, { rebuildManifest, refreshProjectConfig }),
    );
    expect(createdFileSystemWatchers).toHaveLength(1);
    watcher = createdFileSystemWatchers[0];
    rebuildManifest.mockClear();
    refreshProjectConfig.mockClear();
  });

  afterEach(async () => {
    await integration.dispose();
    jest.useRealTimers();
  });

  it("watches source extensions under the project root", () => {
    expect(watcher.pattern).toEqual({
      base: root,
      pattern: "**/*.{sql,yml,yaml,csv}",
    });
  });

  it("rebuilds once after the debounce for model edits", async () => {
    watcher.fire("change", path.join(root, "models", "a.sql"));
    watcher.fire("create", path.join(root, "models", "b.sql"));
    watcher.fire("delete", path.join(root, "seeds", "c.csv"));
    await jest.advanceTimersByTimeAsync(499);
    expect(rebuildManifest).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(rebuildManifest).toHaveBeenCalledTimes(1);
    expect(refreshProjectConfig).not.toHaveBeenCalled();
  });

  it("ignores edits outside the model, macro and seed paths", async () => {
    watcher.fire("change", path.join(root, "target", "compiled", "a.sql"));
    watcher.fire("change", path.join(root, "models_old", "a.sql"));
    await jest.advanceTimersByTimeAsync(1000);
    expect(rebuildManifest).not.toHaveBeenCalled();
  });

  it("refreshes config, then rebuilds, after a dbt_project.yml edit", async () => {
    const configChanged = jest.fn();
    integration.on(
      FusionProjectIntegrationEvents.PROJECT_CONFIG_CHANGED,
      configChanged,
    );
    watcher.fire("change", path.join(root, "dbt_project.yml"));
    await jest.advanceTimersByTimeAsync(500);
    expect(refreshProjectConfig).toHaveBeenCalledTimes(1);
    expect(configChanged).toHaveBeenCalledTimes(1);
    expect(rebuildManifest).toHaveBeenCalledTimes(1);
    expect(refreshProjectConfig.mock.invocationCallOrder[0]).toBeLessThan(
      rebuildManifest.mock.invocationCallOrder[0],
    );
  });

  it("drops a pending rebuild and stops watching on dispose", async () => {
    watcher.fire("change", path.join(root, "models", "a.sql"));
    await integration.dispose();
    await jest.advanceTimersByTimeAsync(1000);
    expect(rebuildManifest).not.toHaveBeenCalled();
    expect(watcher.dispose).toHaveBeenCalled();
    expect(watcher.listeners.change).toHaveLength(0);
  });
});
