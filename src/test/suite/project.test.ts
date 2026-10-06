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
  type Mocked,
  vi,
} from "vitest";
import * as vscode from "vscode";
import { DBTCommand, QueryExecution } from "../../core/dbtCommand";
import { DBTDiagnosticData } from "../../core/diagnostics";
import type { Log } from "../../core/log";
import {
  ChildrenParentParser,
  DocParser,
  ExposureParser,
  FunctionParser,
  GraphParser,
  MacroParser,
  MetricParser,
  ModelDepthParser,
  NodeParser,
  SemanticModelParser,
  SourceParser,
  TestParser,
  UnitTestParser,
} from "../../core/manifest";
import { RESOURCE_TYPE_MODEL } from "../../core/manifest/types";
import { DBT_PROJECT_FILE } from "../../core/project";
import {
  MANIFEST_FILE,
  type ParsedManifest,
} from "../../dbt_integration/domain";
import { FusionCli } from "../../fusion/fusionCli";
import { DbtTaskTerminal } from "../../projects/dbtTask";
import { ManifestParsers } from "../../projects/manifest";
import { Project } from "../../projects/project";
import { ProjectCommandDeps, queueCli } from "../../projects/projectCommands";
import { ProjectDiagnostics } from "../../projects/projectDiagnostics";
import { RunHistoryService } from "../../projects/runHistoryService";
import { SharedStateService } from "../../projects/sharedStateService";
import { CONFIGURATION_SECTION } from "../../settings";
import { esmDirname } from "../esmDirname";
import {
  createdFileSystemWatchers,
  type MockFileSystemWatcher,
  resetMocks,
} from "../mock/vscode";
import { buildTestProject } from "../projectHarness";

const fixtureRoot = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/single-project",
);

const commandDeps = (project: Project) =>
  (project as unknown as { commandDeps: ProjectCommandDeps }).commandDeps;
const enqueueCommand = (
  deps: ProjectCommandDeps,
  command: DBTCommand,
  terminal: DbtTaskTerminal,
) =>
  queueCli(
    {
      ...deps,
      cli: () => ({ prepare: () => command }) as unknown as FusionCli,
    },
    { kind: "run", select: "my_model" },
    terminal,
  );
const projectDiagnostics = (project: Project) =>
  (project as unknown as { diagnostics: ProjectDiagnostics }).diagnostics;
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function realParsers(terminal: Log): ManifestParsers {
  return {
    childrenParentParser: new ChildrenParentParser(),
    nodeParser: new NodeParser(terminal),
    macroParser: new MacroParser(terminal),
    metricParser: new MetricParser(terminal),
    graphParser: new GraphParser(terminal),
    sourceParser: new SourceParser(terminal),
    testParser: new TestParser(terminal),
    unitTestParser: new UnitTestParser(terminal),
    exposureParser: new ExposureParser(terminal),
    functionParser: new FunctionParser(terminal),
    docParser: new DocParser(terminal),
    modelDepthParser: new ModelDepthParser(terminal),
    semanticModelParser: new SemanticModelParser(terminal),
  };
}

describe("Project Test Suite", () => {
  let mockTerminal: Mocked<Log>;
  let mockSharedStateService: Mocked<SharedStateService>;
  let mockRunHistoryService: Mocked<RunHistoryService>;
  let mockFusionCli: any;
  let dbtProject: Project;

  function newProject(projectUri = vscode.Uri.file("/test/project")): Project {
    return buildTestProject(projectUri.fsPath, () => mockFusionCli, {
      terminal: mockTerminal,
      sharedState: mockSharedStateService,
      runHistoryService: mockRunHistoryService,
      projectRoot: projectUri,
    });
  }

  async function initializedProject(): Promise<Project> {
    const project = newProject();
    await project.initialize();
    return project;
  }

  beforeEach(() => {
    const workspaceFolder = {
      uri: vscode.Uri.file("/test/workspace"),
      name: "Test Workspace",
      index: 0,
    };
    Object.assign(vscode.workspace as object, {
      workspaceFolders: [workspaceFolder],
    });
    (vscode.workspace.getWorkspaceFolder as Mock).mockReturnValue(
      workspaceFolder,
    );
    (vscode.workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === "query.limit") {
          return 500;
        }
        if (key === "defer.perProject") {
          return {};
        }
        return undefined;
      }),
      has: vi.fn(),
      update: vi.fn(),
    });
    mockTerminal = {
      show: vi.fn(),
      log: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      dispose: vi.fn(),
      logNewLine: vi.fn(),
      logLine: vi.fn(),
      logHorizontalRule: vi.fn(),
      logBlock: vi.fn(),
      warn: vi.fn(),
    } as unknown as Mocked<Log>;
    mockSharedStateService = {} as unknown as Mocked<SharedStateService>;
    mockRunHistoryService = {
      addEntry: vi.fn(),
      notifyCommandFailed: vi.fn(),
    } as unknown as Mocked<RunHistoryService>;

    mockFusionCli = {
      prepare: vi.fn(),
      run: vi.fn(() => Promise.resolve()),
      refreshProjectConfig: vi.fn(async () => undefined),
      rebuildManifest: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
      getProjectName: vi.fn().mockReturnValue("test-project"),
      getColumnsOfModel: vi.fn(() => Promise.resolve([])),
      getColumnsOfSource: vi.fn(() => Promise.resolve([])),
      compileInline: vi.fn(),
      executeSQL: vi.fn(),
      getTargetPath: vi.fn().mockReturnValue("/project/target"),
      getPackageInstallPath: vi.fn().mockReturnValue("/project/dbt_packages"),
      getModelPaths: vi.fn().mockReturnValue(["/project/models"]),
      getSeedPaths: vi.fn().mockReturnValue(["/project/seeds"]),
      getMacroPaths: vi.fn().mockReturnValue(["/project/macros"]),
      getDiagnostics: vi.fn().mockReturnValue({
        rebuildManifestDiagnostics: [],
        projectConfigDiagnostics: [],
      }),
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    resetMocks();
    if (dbtProject) {
      await dbtProject.dispose();
    }
  });

  describe("Constructor and Initialization", () => {
    it("should have access to dbt integration constants", () => {
      expect(DBT_PROJECT_FILE).toBe("dbt_project.yml");
      expect(MANIFEST_FILE).toBe("manifest.json");
      expect(RESOURCE_TYPE_MODEL).toBe("model");
    });

    it("should create Project instance with correct configuration", () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = newProject(projectUri);

      expect(dbtProject).toBeInstanceOf(Project);
      expect(dbtProject.projectRoot).toBe(projectUri);
      expect(mockTerminal.debug).toHaveBeenCalledWith(
        "Project",
        expect.stringContaining("Created fusion dbt project"),
      );
    });

    it("should commit the Fusion CLI on initialize()", async () => {
      dbtProject = newProject();
      expect(() => dbtProject.getFusionCli()).toThrow(/not initialized/);

      await dbtProject.initialize();

      expect(dbtProject.getFusionCli()).toBe(mockFusionCli);
      expect(mockFusionCli.refreshProjectConfig).toHaveBeenCalled();
      expect(mockFusionCli.rebuildManifest).toHaveBeenCalled();
    });
  });

  describe("Project Configuration Methods", () => {
    beforeEach(async () => {
      dbtProject = await initializedProject();
    });

    it("should get project name", () => {
      expect(dbtProject.getProjectName()).toBe("test-project");
      expect(mockFusionCli.getProjectName).toHaveBeenCalled();
    });

    it("should get project root", () => {
      expect(dbtProject.getProjectRoot()).toBe("/test/project");
    });

    it("should get DBT project file path", () => {
      expect(dbtProject.getDBTProjectFilePath()).toBe(
        path.join("/test/project", DBT_PROJECT_FILE),
      );
    });

    it("falls back to the directory name before a CLI is committed", async () => {
      await dbtProject.dispose();
      dbtProject = newProject();
      expect(dbtProject.getProjectName()).toBe("project");
    });
  });

  describe("Diagnostics", () => {
    beforeEach(async () => {
      dbtProject = await initializedProject();
    });

    it("should get all diagnostics", () => {
      const mockDiagnosticData: DBTDiagnosticData = {
        message: "Test diagnostic",
        severity: "error",
        filePath: "/test/file.sql",
        source: "dbt",
        category: "error",
        range: {
          startLine: 1,
          startColumn: 0,
          endLine: 1,
          endColumn: 10,
        },
      };

      (mockFusionCli.getDiagnostics as Mock).mockReturnValue({
        rebuildManifestDiagnostics: [mockDiagnosticData],
        projectConfigDiagnostics: [],
      });
      dbtProject.updateDiagnosticsInProblemsPanel();

      const diagnostics = dbtProject.getAllDiagnostic();

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        message: mockDiagnosticData.message,
        severity: vscode.DiagnosticSeverity.Error,
        source: "Fusion Power User",
        code: "rebuild-manifest",
      });
      expect(() => dbtProject.throwDiagnosticsErrorIfAvailable()).toThrow(
        "Test diagnostic",
      );
    });

    it("publishes every kind in one collection under dbt_project.yml", async () => {
      const data = (message: string, source: string): DBTDiagnosticData => ({
        message,
        severity: "warning",
        filePath: "/test/file.sql",
        source,
        category: "warning",
      });
      const getDiagnostics = mockFusionCli.getDiagnostics as Mock;
      getDiagnostics.mockReturnValue({
        rebuildManifestDiagnostics: [data("rebuild", "dbt-fusion")],
        projectConfigDiagnostics: [],
      });

      dbtProject.updateDiagnosticsInProblemsPanel();
      projectDiagnostics(dbtProject).addConfig(data("config", "dbt"));
      projectDiagnostics(dbtProject).addConfig(
        data("executable", "fusion-executable"),
      );

      const collections = (
        vscode.languages.createDiagnosticCollection as Mock
      ).mock.results.map((result) => result.value);
      expect(
        (vscode.languages.createDiagnosticCollection as Mock).mock.calls,
      ).toEqual([["fusionPowerUser.project"]]);
      const [collection] = collections;
      const published = collection.get(
        vscode.Uri.file(dbtProject.getDBTProjectFilePath()),
      );
      expect(
        published.map((d: vscode.Diagnostic) => [d.message, d.code, d.source]),
      ).toEqual([
        ["rebuild", "rebuild-manifest", "Fusion Power User"],
        ["config", "project-config", "Fusion Power User"],
        ["executable", "fusion-executable", "Fusion Power User"],
      ]);

      // A rebuild that clears its own diagnostics keeps the other kinds.
      getDiagnostics.mockReturnValue({
        rebuildManifestDiagnostics: [],
        projectConfigDiagnostics: [],
      });
      await dbtProject.rebuildManifest();
      await flush();
      expect(dbtProject.getAllDiagnostic().map((d) => d.code)).toEqual([
        "project-config",
        "fusion-executable",
      ]);
    });
  });

  describe("Query Execution", () => {
    beforeEach(async () => {
      dbtProject = await initializedProject();
    });

    it("should compile query", async () => {
      const mockCompiledSQL = "SELECT col1 FROM table";
      mockFusionCli.compileInline.mockResolvedValue(mockCompiledSQL);

      const result = await dbtProject.compileQuery(
        "SELECT col1 FROM {{ ref('table') }}",
      );

      expect(result).toEqual(mockCompiledSQL);
      expect(mockFusionCli.compileInline).toHaveBeenCalledWith(
        "SELECT col1 FROM {{ ref('table') }}",
      );
    });

    it("should get column values", async () => {
      mockFusionCli.executeSQL.mockResolvedValue(
        new QueryExecution(
          async () => undefined,
          async () => ({
            table: {
              column_names: ["col"],
              column_types: ["string"],
              rows: [["value1"], ["value2"]],
            },
            compiled_sql: "",
            raw_sql: "",
            modelName: "model",
          }),
        ),
      );

      const result = await dbtProject.getColumnValues("model", "col");

      expect(result).toEqual(["value1", "value2"]);
      expect(mockFusionCli.executeSQL).toHaveBeenCalledWith(
        "SELECT DISTINCT col FROM {{ ref('model') }}",
        100,
        "model",
      );
    });
  });

  describe("Column Operations", () => {
    beforeEach(async () => {
      dbtProject = await initializedProject();
    });

    it("should get columns of model", async () => {
      const mockColumns = [
        { name: "col1", type: "varchar" },
        { name: "col2", type: "integer" },
      ];
      mockFusionCli.getColumnsOfModel.mockImplementation(() =>
        Promise.resolve(mockColumns),
      );

      const result = await dbtProject.getColumnsOfModel("model.test.my_model");

      expect(result).toEqual(mockColumns);
      expect(mockFusionCli.getColumnsOfModel).toHaveBeenCalledWith(
        "model.test.my_model",
      );
    });

    it("should get columns of source", async () => {
      const mockColumns = [{ name: "col1", type: "varchar" }];
      mockFusionCli.getColumnsOfSource.mockImplementation(() =>
        Promise.resolve(mockColumns),
      );

      const result = await dbtProject.getColumnsOfSource(
        "my_source",
        "my_table",
      );

      expect(result).toEqual(mockColumns);
      expect(mockFusionCli.getColumnsOfSource).toHaveBeenCalledWith(
        "my_source",
        "my_table",
      );
    });
  });

  describe("Disposal", () => {
    it("should dispose all resources properly", async () => {
      dbtProject = await initializedProject();

      const { results } = (vscode.languages.createDiagnosticCollection as Mock)
        .mock;
      const collection = results[results.length - 1]
        .value as vscode.DiagnosticCollection;

      await dbtProject.dispose();

      expect(collection.dispose).toHaveBeenCalled();
      expect(mockFusionCli.dispose).toHaveBeenCalled();
      expect(mockTerminal.dispose).not.toHaveBeenCalled();
      expect(() => dbtProject.getFusionCli()).toThrow();
    });

    it("ignores a rebuild that finishes after dispose", async () => {
      dbtProject = await initializedProject();
      const { results } = (vscode.languages.createDiagnosticCollection as Mock)
        .mock;
      const collection = results[results.length - 1].value;
      let release!: () => void;
      mockFusionCli.rebuildManifest.mockImplementation(
        () => new Promise<void>((resolve) => (release = resolve)),
      );

      await dbtProject.rebuildManifest();
      await flush();
      await dbtProject.dispose();
      collection.set.mockClear();
      release();
      await flush();

      expect(collection.set).not.toHaveBeenCalled();
    });
  });

  describe("queued command run_results", () => {
    let targetDir: string;

    beforeEach(() => {
      targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-project-run-"));
      mockFusionCli.getTargetPath.mockReturnValue(targetDir);
    });

    afterEach(() => {
      fs.rmSync(targetDir, { recursive: true, force: true });
    });

    function writeRunResults(): void {
      fs.writeFileSync(
        path.join(targetDir, "run_results.json"),
        JSON.stringify({
          metadata: {
            invocation_id: "inv-1",
            generated_at: "2026-01-01T00:00:00Z",
          },
          args: { which: "run" },
          results: [{ unique_id: "model.test.model1", status: "error" }],
        }),
      );
    }

    function mockDeferSettings(storedDeferConfig: Record<string, unknown>) {
      (vscode.workspace.getConfiguration as Mock).mockImplementation(() => ({
        get: vi.fn((key: string) => {
          if (key === "defer.perProject") {
            return { finance_general: storedDeferConfig };
          }
          if (key === "query.limit") {
            return 500;
          }
          return undefined;
        }),
        has: vi.fn(),
        update: vi.fn(),
      }));
    }

    const financeUri = vscode.Uri.file("/test/workspace/finance_general");

    it("records fresh run_results before surfacing Encountered an error", async () => {
      dbtProject = await initializedProject();

      const mockCommand = {
        execute: vi.fn(() => {
          writeRunResults();
          return Promise.resolve({
            stdout: "Encountered an error: model failed",
          });
        }),
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      enqueueCommand(
        commandDeps(dbtProject),
        mockCommand as unknown as DBTCommand,
        new DbtTaskTerminal(() => undefined),
      ).catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockCommand.execute).toHaveBeenCalled();
      expect(mockRunHistoryService.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ id: "inv-1", projectName: "test-project" }),
      );
      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select my_model",
        expect.stringContaining("Encountered an error:"),
      );
      const addOrder =
        mockRunHistoryService.addEntry.mock.invocationCallOrder[0];
      const failOrder =
        mockRunHistoryService.notifyCommandFailed.mock.invocationCallOrder[0];
      expect(addOrder).toBeLessThan(failOrder);
    });

    it("records the launched selection when run_results.json has none", async () => {
      dbtProject = await initializedProject();
      mockFusionCli.prepare.mockImplementation(() => ({
        args: ["run", "--select", "stg_orders", "--profiles-dir", "/p"],
        execute: vi.fn(() => {
          writeRunResults();
          return Promise.resolve({ stdout: "" });
        }),
        focus: false,
        showProgress: false,
        getCommandAsString: () => "dbt run --select stg_orders",
      }));

      await dbtProject.runModel({
        plusOperatorLeft: "",
        modelName: "stg_orders",
        plusOperatorRight: "",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockRunHistoryService.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "dbt run --select stg_orders",
          args: ["stg_orders"],
        }),
      );
    });

    it("reads defer.perProject scoped to the project root", async () => {
      mockDeferSettings({
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "/tmp/manifest.json",
      });
      dbtProject = newProject(financeUri);

      expect(dbtProject.getDeferConfig()).toEqual({
        deferToProduction: true,
        favorState: false,
        manifestPath: path.resolve("/tmp/manifest.json"),
      });
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
        CONFIGURATION_SECTION,
        financeUri,
      );
    });

    it("resolves a relative manifestPathForDeferral against the project root", async () => {
      mockDeferSettings({
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "state",
      });
      dbtProject = newProject(financeUri);

      expect(dbtProject.getDeferConfig()?.manifestPath).toBe(
        path.join(financeUri.fsPath, "state"),
      );
    });

    it("does not honor a remote manifestPathType or hosted integration id from settings", async () => {
      // Not part of the settings schema, but exercised in case a user's settings.json sets it directly.
      mockDeferSettings({
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "/tmp/manifest.json",
        manifestPathType: "remote",
        dbtCoreIntegrationId: 42,
      });
      dbtProject = newProject(financeUri);

      expect(dbtProject.getDeferConfig()).toEqual({
        deferToProduction: true,
        favorState: false,
        manifestPath: path.resolve("/tmp/manifest.json"),
      });
    });

    it("does not parse run_results when execute rejects", async () => {
      dbtProject = await initializedProject();

      const mockCommand = {
        execute: vi.fn(() => {
          writeRunResults();
          return Promise.reject(new Error("cancelled"));
        }),
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      enqueueCommand(
        commandDeps(dbtProject),
        mockCommand as unknown as DBTCommand,
        new DbtTaskTerminal(() => undefined),
      ).catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockRunHistoryService.addEntry).not.toHaveBeenCalled();
      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select my_model",
        "Error: cancelled",
      );
    });
  });

  describe("Fusion CLI operation routing", () => {
    async function queued() {
      const execute = vi.fn(() => Promise.resolve({ stdout: "" }));
      mockFusionCli.prepare.mockImplementation(() => ({
        execute,
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt",
      }));
      dbtProject = await initializedProject();
      return execute;
    }

    it.each([
      ["", "", "my_model"],
      ["+", "", "+my_model"],
      ["", "+", "my_model+"],
      ["+", "+", "+my_model+"],
    ])(
      "prepares run and build for %s my_model %s",
      async (plusOperatorLeft, plusOperatorRight, select) => {
        await queued();
        const params = {
          plusOperatorLeft,
          modelName: "my_model",
          plusOperatorRight,
        };

        await dbtProject.runModel(params);
        await dbtProject.buildModel(params);
        await dbtProject.compileModel(params);

        expect(mockFusionCli.prepare.mock.calls.map(([c]: any) => c)).toEqual([
          { kind: "run", select },
          { kind: "build", select },
          { kind: "compile", select },
        ]);
      },
    );

    it("prepares a whole-project build and test selections", async () => {
      await queued();

      await dbtProject.buildProject();
      await dbtProject.runTest("my_test");
      await dbtProject.runModelTest("my_model");

      expect(mockFusionCli.prepare.mock.calls.map(([c]: any) => c)).toEqual([
        { kind: "build" },
        { kind: "test", select: "my_test" },
        { kind: "test", select: "my_model" },
      ]);
    });

    it("queues the prepared command for execution", async () => {
      const execute = await queued();

      await dbtProject.compileModel({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(execute).toHaveBeenCalled();
    });

    it("logs a preparation failure instead of rejecting", async () => {
      dbtProject = await initializedProject();
      mockFusionCli.prepare.mockImplementation(() => {
        throw new Error("compilation failed");
      });

      await expect(
        dbtProject.compileModel({
          plusOperatorLeft: "",
          modelName: "my_model",
          plusOperatorRight: "",
        }),
      ).resolves.toBeUndefined();

      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt compile --select my_model",
        "Error: compilation failed",
      );
      expect(mockTerminal.error).toHaveBeenCalledWith(
        "commandPreparationError",
        "Unable to prepare dbt compile --select my_model",
        expect.any(Error),
      );
    });

    it("names the configured commandParams in a preparation failure", async () => {
      (vscode.workspace.getConfiguration as Mock).mockReturnValue({
        get: vi.fn((key: string) =>
          key === "run.additionalParams" ? ["--full-refresh"] : undefined,
        ),
        has: vi.fn(),
        update: vi.fn(),
      });
      dbtProject = await initializedProject();
      mockFusionCli.prepare.mockImplementation(() => {
        throw new Error("no executable");
      });

      await dbtProject.runModel({
        plusOperatorLeft: "+",
        modelName: "my_model",
        plusOperatorRight: "",
      });

      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select +my_model --full-refresh",
        "Error: no executable",
      );
    });

    it("routes clean through the Fusion CLI and queues installDeps", async () => {
      await queued();

      await dbtProject.clean();
      await dbtProject.installDeps();

      expect(mockFusionCli.run).toHaveBeenCalledWith({ kind: "clean" });
      expect(mockFusionCli.prepare).toHaveBeenCalledWith({ kind: "deps" });
    });

    it("queues a manual task's command to run in its terminal", async () => {
      const execute = await queued();
      const terminal = new DbtTaskTerminal(() => undefined);
      const closed = new Promise<number>((resolve) =>
        terminal.onDidClose(resolve),
      );
      execute.mockResolvedValue({ stdout: "", exitCode: 0 } as never);

      await dbtProject.runTask(
        { type: "dbt", command: "run", select: "a", fullRefresh: true },
        terminal,
      );

      expect(mockFusionCli.prepare).toHaveBeenCalledWith({
        kind: "run",
        select: "a",
        fullRefresh: true,
      });
      await expect(closed).resolves.toBe(0);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("closes a manual task with an unknown command as failed", async () => {
      await queued();
      const terminal = new DbtTaskTerminal(() => undefined);
      const closed = new Promise<number>((resolve) =>
        terminal.onDidClose(resolve),
      );

      await dbtProject.runTask(
        { type: "dbt", command: "seed" as never },
        terminal,
      );

      await expect(closed).resolves.toBe(1);
      expect(mockFusionCli.prepare).not.toHaveBeenCalled();
    });

    it("starts a command's task outside the queue and runs it once in the task terminal", async () => {
      const execute = await queued();
      execute.mockResolvedValue({ stdout: "", exitCode: 0 } as never);

      await dbtProject.runModel({
        plusOperatorLeft: "",
        modelName: "a",
        plusOperatorRight: "",
      });
      await flush();

      expect(vscode.tasks.executeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          definition: expect.objectContaining({ command: "run", select: "a" }),
        }),
      );
      expect(execute).toHaveBeenCalledTimes(1);
      expect(vscode.window.withProgress).not.toHaveBeenCalled();
    });

    it("runs a command once more after Run Task's identical task ends, without deadlocking", async () => {
      const execute = await queued();
      let release!: () => void;
      execute.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ stdout: "", exitCode: 0 } as never);
          }),
      );
      const definition = {
        type: "dbt",
        command: "deps",
        project: dbtProject.projectRoot.fsPath,
      } as const;
      await vscode.tasks.executeTask(dbtProject.task(definition, "deps"));
      await flush();

      const installed = dbtProject.installDeps();
      await flush();
      expect(execute).toHaveBeenCalledTimes(1);

      release();
      await flush();
      expect(execute).toHaveBeenCalledTimes(2);
      release();
      await expect(installed).resolves.toBeUndefined();
    });

    it("rejects installDeps on a non-zero exit or a reported dbt error", async () => {
      const execute = await queued();
      execute.mockResolvedValueOnce({ stdout: "", exitCode: 2 } as never);
      await expect(dbtProject.installDeps()).rejects.toThrow(
        "dbt deps exited with code 2",
      );

      execute.mockResolvedValueOnce({
        stdout: "Encountered an error: no packages",
        exitCode: 0,
      } as never);
      await expect(dbtProject.installDeps()).rejects.toThrow(
        "Encountered an error: no packages",
      );
    });

    it("queues each terminal of one task, so Rerun runs the command again", async () => {
      const execute = await queued();
      execute.mockResolvedValue({ stdout: "", exitCode: 0 } as never);
      const task = dbtProject.task(
        {
          type: "dbt",
          command: "build",
          project: dbtProject.projectRoot.fsPath,
        },
        "build",
      );

      await vscode.tasks.executeTask(task);
      await flush();
      await vscode.tasks.executeTask(task);
      await flush();

      expect(execute).toHaveBeenCalledTimes(2);
    });

    it("runs the command without a terminal when VS Code cannot execute tasks, warning once", async () => {
      const execute = await queued();
      execute.mockResolvedValue({ stdout: "", exitCode: 0 } as never);
      const unsupported = new Error("tasks unsupported");
      vi.mocked(vscode.tasks.executeTask)
        .mockRejectedValueOnce(unsupported)
        .mockRejectedValueOnce(unsupported)
        .mockRejectedValueOnce(unsupported);

      await dbtProject.installDeps();
      await dbtProject.buildProject();
      await flush();

      expect(execute).toHaveBeenCalledTimes(2);
      expect(mockTerminal.warn).toHaveBeenCalledTimes(1);
      expect(mockTerminal.warn).toHaveBeenCalledWith(
        "Project",
        expect.stringContaining("tasks unsupported"),
      );
      execute.mockResolvedValueOnce({ stdout: "", exitCode: 2 } as never);
      await expect(dbtProject.installDeps()).rejects.toThrow(
        "dbt deps exited with code 2",
      );
    });

    it("does not run a task whose terminal closed while it waited in the queue", async () => {
      const execute = await queued();
      let release!: () => void;
      execute.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ stdout: "", exitCode: 0 } as never);
          }),
      );
      const first = new DbtTaskTerminal(() => undefined);
      const waiting = new DbtTaskTerminal(() => undefined);
      const written: string[] = [];
      waiting.onDidWrite((text) => written.push(text));
      void dbtProject.runTask({ type: "dbt", command: "build" }, first);
      const run = dbtProject.runTask({ type: "dbt", command: "deps" }, waiting);
      await flush();

      waiting.close();
      release();

      await expect(run).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(written).toEqual([
        "Waiting for the previous dbt command to finish…\r\n",
      ]);
      expect(mockRunHistoryService.addEntry).not.toHaveBeenCalled();
    });
  });
});

function mockTerminal(): Log {
  return {
    debug: () => undefined,
    info: () => undefined,
    log: () => undefined,
    error: () => undefined,
    warn: () => undefined,
    trace: () => undefined,
  } as unknown as Log;
}

function stubDelegate(
  projectRoot: string,
  overrides: Partial<FusionCli> = {},
): FusionCli {
  const stub: Partial<FusionCli> = {
    refreshProjectConfig: vi.fn(async () => undefined),
    rebuildManifest: vi.fn(async () => undefined),
    dispose: vi.fn(),
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

async function buildProject(
  projectRoot: string,
  fusionDelegate: FusionCli,
): Promise<Project> {
  const terminal = mockTerminal();
  const project = buildTestProject(projectRoot, () => fusionDelegate, {
    terminal,
    parsers: realParsers(terminal),
  });
  await project.initialize();
  return project;
}

function copyFixture(prefix: string): { root: string; targetDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return { root, targetDir: path.join(root, "target") };
}

describe("Project manifest", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("publishes contract map keys from manifest.json", async () => {
    const { root, targetDir } = copyFixture("fusion-int-");
    tempRoot = root;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(
      path.join(fixtureRoot, "manifest.contract.json"),
      path.join(targetDir, MANIFEST_FILE),
    );
    const project = await buildProject(
      root,
      stubDelegate(root, {
        getTargetPath: () => targetDir,
        getPackageInstallPath: () => path.join(root, "dbt_packages"),
      }),
    );
    const parses: ParsedManifest[] = [];
    project.onDidParse((parsed) => parses.push(parsed));
    const lastParse = () => {
      const parse = parses[parses.length - 1];
      if (!parse) {
        throw new Error("Expected a parse event");
      }
      return parse;
    };

    await project.parseManifest();
    const first = project.publishMerged(lastParse(), false);
    await project.parseManifest();
    const second = project.publishMerged(lastParse(), true);
    expect(project.graphNotice()).toBeUndefined();

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) {
      throw new Error("Expected publications");
    }
    expect([...first.nodeMetaMap.nodes()].length).toBeGreaterThan(0);
    expect(first.macroMetaMap.size).toBeGreaterThan(0);
    expect(second.publicationEpoch).toBe(first.publicationEpoch + 1);
    expect(project.manifest?.publicationEpoch).toBe(second.publicationEpoch);
    expect(project.manifest).toBe(second);
    await project.dispose();
  });

  it("fires onDidParse for each parse without publishing a manifest", async () => {
    const { root, targetDir } = copyFixture("fusion-changed-");
    tempRoot = root;
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(
      path.join(fixtureRoot, "manifest.contract.json"),
      path.join(targetDir, MANIFEST_FILE),
    );
    const project = await buildProject(
      root,
      stubDelegate(root, {
        getTargetPath: () => targetDir,
        getPackageInstallPath: () => path.join(root, "dbt_packages"),
      }),
    );
    const parsed = vi.fn();
    project.onDidParse(parsed);

    await project.parseManifest();

    expect(parsed).toHaveBeenCalledTimes(1);
    expect(project.manifest).toBeUndefined();

    await project.dispose();
    parsed.mockClear();
    await project.parseManifest().catch(() => undefined);
    expect(parsed).not.toHaveBeenCalled();
  });

  it("reads the adapter type from manifest metadata, unknown before a manifest", async () => {
    const { root, targetDir } = copyFixture("fusion-adapter-");
    tempRoot = root;
    const project = await buildProject(
      root,
      stubDelegate(root, {
        getTargetPath: () => targetDir,
        getPackageInstallPath: () => path.join(root, "dbt_packages"),
      }),
    );
    expect(project.getAdapterType()).toBe("unknown");

    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, "manifest.contract.json"), "utf8"),
    );
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, MANIFEST_FILE),
      JSON.stringify({ ...manifest, metadata: { adapter_type: "duckdb" } }),
    );
    await project.parseManifest();

    expect(project.getAdapterType()).toBe("duckdb");

    const { metadata: _metadata, ...withoutMetadata } = manifest;
    fs.writeFileSync(
      path.join(targetDir, MANIFEST_FILE),
      JSON.stringify(withoutMetadata),
    );
    await project.parseManifest();
    expect(project.getAdapterType()).toBe("duckdb");
    await project.dispose();
  });

  describe("query column types", () => {
    function fabricatedExecuteSQL(): Mock<() => Promise<QueryExecution>> {
      // Mirrors the published integration's real dbt show --output json shape: real row
      // values, but column_types fabricated as the literal string "string" for every column.
      return vi.fn(
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
      const project = await buildProject(
        tempRoot,
        stubDelegate(tempRoot, { executeSQL }),
      );

      const execution = await project.executeSQLWithLimit(
        "select 1 as a, 'x' as b",
        "my_model",
        500,
      );
      const result = await execution.executeQuery();

      expect(executeSQL).toHaveBeenCalled();
      expect(result.table.column_types).toEqual([null, null]);
      expect(result.table.column_names).toEqual(["a", "b"]);
      await project.dispose();
    });

    it("reports every column type as unknown for immediatelyExecuteSQLWithLimit", async () => {
      tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "fusion-show-immediate-"),
      );
      const project = await buildProject(
        tempRoot,
        stubDelegate(tempRoot, { executeSQL: fabricatedExecuteSQL() }),
      );

      const result = await project.immediatelyExecuteSQLWithLimit(
        "select 1 as a, 'x' as b",
        "my_model",
        500,
      );

      expect(result.columnTypes).toEqual([null, null]);
      await project.dispose();
    });

    it("forwards cancellation to the underlying query execution", async () => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fusion-show-cancel-"));
      const cancel = vi.fn(async () => undefined);
      const project = await buildProject(
        tempRoot,
        stubDelegate(tempRoot, {
          executeSQL: vi.fn(
            async () =>
              new QueryExecution(cancel, async () => {
                throw new Error("should not execute after cancel in this test");
              }),
          ),
        }),
      );

      const execution = await project.executeSQLWithLimit(
        "select 1",
        "my_model",
        500,
      );
      await execution.cancel();

      expect(cancel).toHaveBeenCalled();
      await project.dispose();
    });
  });
});

describe("Project manifest trigger", () => {
  const root = "/project";
  let rebuildManifest: Mock<() => Promise<void>>;
  let refreshProjectConfig: Mock<() => Promise<void>>;
  let project: Project;
  let watcher: MockFileSystemWatcher;

  beforeEach(async () => {
    vi.useFakeTimers();
    createdFileSystemWatchers.length = 0;
    rebuildManifest = vi.fn(async () => undefined);
    refreshProjectConfig = vi.fn(async () => undefined);
    project = await buildProject(
      root,
      stubDelegate(root, { rebuildManifest, refreshProjectConfig }),
    );
    expect(createdFileSystemWatchers).toHaveLength(1);
    watcher = createdFileSystemWatchers[0];
    rebuildManifest.mockClear();
    refreshProjectConfig.mockClear();
  });

  afterEach(async () => {
    await project.dispose();
    vi.useRealTimers();
  });

  it("watches source extensions under the project root", () => {
    expect(watcher.pattern).toEqual({
      base: root,
      pattern: "**/*.{sql,yml,yaml,csv}",
    });
  });

  it("rebuilds once after the debounce for model edits", async () => {
    const sourceFileChanged = vi.fn();
    project.onSourceFileChanged(sourceFileChanged);
    watcher.fire("change", path.join(root, "models", "a.sql"));
    watcher.fire("create", path.join(root, "models", "b.sql"));
    watcher.fire("delete", path.join(root, "seeds", "c.csv"));
    await vi.advanceTimersByTimeAsync(499);
    expect(rebuildManifest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rebuildManifest).toHaveBeenCalledTimes(1);
    expect(refreshProjectConfig).not.toHaveBeenCalled();
    expect(sourceFileChanged).toHaveBeenCalledTimes(1);
    expect(project.manifest?.publicationEpoch ?? 0).toBe(0);
  });

  it("ignores edits outside the model, macro and seed paths", async () => {
    watcher.fire("change", path.join(root, "target", "compiled", "a.sql"));
    watcher.fire("change", path.join(root, "models_old", "a.sql"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(rebuildManifest).not.toHaveBeenCalled();
  });

  it("refreshes config, then rebuilds, after a dbt_project.yml edit", async () => {
    watcher.fire("change", path.join(root, "dbt_project.yml"));
    await vi.advanceTimersByTimeAsync(500);
    expect(refreshProjectConfig).toHaveBeenCalledTimes(1);
    expect(rebuildManifest).toHaveBeenCalledTimes(1);
    expect(refreshProjectConfig.mock.invocationCallOrder[0]).toBeLessThan(
      rebuildManifest.mock.invocationCallOrder[0],
    );
  });

  it("drops a pending rebuild and stops watching on dispose", async () => {
    watcher.fire("change", path.join(root, "models", "a.sql"));
    await project.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rebuildManifest).not.toHaveBeenCalled();
    expect(watcher.dispose).toHaveBeenCalled();
    expect(watcher.listeners.change).toHaveLength(0);
  });
});
