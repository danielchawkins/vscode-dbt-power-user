import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { DBT_PROJECT_FILE } from "../../core/project";
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectLog } from "../../dbt_client/dbtProjectLog";
import { ManifestCacheChangedEvent } from "../../dbt_client/event/manifestCacheChangedEvent";
import { FusionProjectIntegrationEvents } from "../../dbt_client/fusionProjectIntegration";
import {
  DBTDiagnosticData,
  DBTTerminal,
  MANIFEST_FILE,
  ParsedManifest,
  RESOURCE_TYPE_MODEL,
} from "../../dbt_integration";
import { RunHistoryService } from "../../services/runHistoryService";
import { SharedStateService } from "../../services/sharedStateService";
import { CONFIGURATION_SECTION } from "../../settings";
describe("DBTProject Test Suite", () => {
  let mockTerminal: jest.Mocked<DBTTerminal>;
  let mockSharedStateService: jest.Mocked<SharedStateService>;
  let mockRunHistoryService: jest.Mocked<RunHistoryService>;
  let mockProjectIntegration: any;
  let mockFusionCli: any;
  let mockDbtProjectLog: jest.Mocked<DBTProjectLog>;
  let mockManifestChangedEmitter: jest.Mocked<
    vscode.EventEmitter<ManifestCacheChangedEvent>
  >;
  let dbtProject: DBTProject;
  let dbtProjectLogFactory: jest.Mock;

  beforeEach(() => {
    // Setup workspace configuration mock
    const workspaceFolder = {
      uri: vscode.Uri.file("/test/workspace"),
      name: "Test Workspace",
      index: 0,
    };
    Object.assign(vscode.workspace as object, {
      workspaceFolders: [workspaceFolder],
    });
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
      workspaceFolder,
    );
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) => {
        if (key === "query.limit") {
          return 500;
        }
        if (key === "defer.perProject") {
          return {};
        }
        return undefined;
      }),
      has: jest.fn(),
      update: jest.fn(),
    });
    // Mock DBTTerminal
    mockTerminal = {
      show: jest.fn(),
      log: jest.fn(),
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      dispose: jest.fn(),
      logNewLine: jest.fn(),
      logLine: jest.fn(),
      logHorizontalRule: jest.fn(),
      logBlock: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<DBTTerminal>;

    // Mock SharedStateService
    mockSharedStateService = {} as unknown as jest.Mocked<SharedStateService>;

    // Mock RunHistoryService
    mockRunHistoryService = {
      addEntry: jest.fn(),
      notifyCommandFailed: jest.fn(),
    } as unknown as jest.Mocked<RunHistoryService>;

    mockFusionCli = { prepare: jest.fn() };

    // Mock FusionProjectIntegration with EventEmitter functionality
    const integrationEventEmitter = new EventEmitter();
    mockProjectIntegration = {
      on: jest.fn().mockImplementation((event: any, listener: any) => {
        integrationEventEmitter.on(event, listener);
      }),
      emit: jest.fn().mockImplementation((event: any, ...args: any) => {
        integrationEventEmitter.emit(event, ...args);
      }),
      getFusionCli: jest.fn(() => mockFusionCli),
      getProjectName: jest.fn().mockReturnValue("test-project"),
      getColumnsOfModel: jest.fn(() => Promise.resolve([])),
      getColumnsOfSource: jest.fn(() => Promise.resolve([])),
      unsafeCompileQuery: jest.fn(),
      runQuery: jest.fn(),
      getColumnValues: jest.fn(),
      getTargetPath: jest.fn().mockReturnValue("/project/target"),
      getPackageInstallPath: jest.fn().mockReturnValue("/project/dbt_packages"),
      getModelPaths: jest.fn().mockReturnValue(["/project/models"]),
      getSeedPaths: jest.fn().mockReturnValue(["/project/seeds"]),
      getMacroPaths: jest.fn().mockReturnValue(["/project/macros"]),
      getDiagnostics: jest.fn().mockReturnValue({
        rebuildManifestDiagnostics: [],
        projectConfigDiagnostics: [],
      }),
      initialize: jest.fn(),
      parseManifest: jest.fn(),
      rebuildManifest: jest.fn(),
      createDbtCommand: jest.fn(),
      runDbtCommand: jest.fn(),
      dispose: jest.fn(),
    };

    // Mock DBTProjectLog
    mockDbtProjectLog = {
      dispose: jest.fn(),
    } as unknown as jest.Mocked<DBTProjectLog>;

    // Create factory that returns the same mock instance
    dbtProjectLogFactory = jest.fn().mockReturnValue(mockDbtProjectLog);

    // Mock EventEmitter for manifest changes
    mockManifestChangedEmitter = {
      event: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      fire: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<vscode.EventEmitter<ManifestCacheChangedEvent>>;
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (dbtProject) {
      dbtProject.dispose();
    }
  });

  describe("Constructor and Initialization", () => {
    it("should have access to dbt integration constants", () => {
      // Verify constants are defined
      expect(DBT_PROJECT_FILE).toBe("dbt_project.yml");
      expect(MANIFEST_FILE).toBe("manifest.json");
      expect(RESOURCE_TYPE_MODEL).toBe("model");
      expect(FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED).toBe(
        "sourceFileChanged",
      );
    });

    it("should create DBTProject instance with correct configuration", () => {
      const projectUri = vscode.Uri.file("/test/project");
      const projectConfig = {};

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(dbtProject.projectRoot).toBe(projectUri);
      expect(mockTerminal.debug).toHaveBeenCalledWith(
        "DbtProject",
        expect.stringContaining("Created fusion dbt project"),
      );
    });

    it("should initialize project integration on initialize()", async () => {
      const projectUri = vscode.Uri.file("/test/project");

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      await dbtProject.initialize();

      expect(mockProjectIntegration.initialize).toHaveBeenCalled();
    });
  });

  describe("Project Configuration Methods", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should get project name", () => {
      expect(dbtProject.getProjectName()).toBe("test-project");
      expect(mockProjectIntegration.getProjectName).toHaveBeenCalled();
    });

    it("should get project root", () => {
      expect(dbtProject.getProjectRoot()).toBe("/test/project");
    });

    it("should get DBT project file path", () => {
      expect(dbtProject.getDBTProjectFilePath()).toBe(
        path.join("/test/project", DBT_PROJECT_FILE),
      );
    });
  });

  describe("Event Handling", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should handle source file changed events", () => {
      const sourceFileChangedHandler = jest.fn();
      dbtProject.onSourceFileChanged(sourceFileChangedHandler);

      // Trigger the event from the integration
      const onCall = mockProjectIntegration.on.mock.calls.find(
        (call: any) =>
          call[0] === FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED,
      );
      expect(dbtProject.getPublicationEpoch()).toBe(0);
      onCall![1](); // Call the handler
      expect(dbtProject.getPublicationEpoch()).toBe(0);

      expect(mockTerminal.debug).toHaveBeenCalledWith(
        "DBTProject",
        "Received sourceFileChanged event from Node.js file watchers",
      );
    });

    it("should handle manifest parsed events", () => {
      const parsedManifest: ParsedManifest = {
        nodeMetaMap: {
          lookupByBaseName: (() => undefined) as any,
          lookupByUniqueId: (() => undefined) as any,
          nodes: (() => []) as any,
        },
        macroMetaMap: new Map(),
        metricMetaMap: new Map(),
        sourceMetaMap: new Map(),
        unitTestMetaMap: new Map(),
        graphMetaMap: {
          parents: new Map(),
          children: new Map(),
          tests: new Map(),
          metrics: new Map(),
        },
        testMetaMap: new Map(),
        docMetaMap: new Map(),
        exposureMetaMap: new Map(),
        modelDepthMap: new Map(),
        functionMetaMap: new Map(),
        semanticModelMetaMap: new Map(),
      };

      // Trigger the event from the integration
      const onCall = mockProjectIntegration.on.mock.calls.find(
        (call: any) =>
          call[0] === FusionProjectIntegrationEvents.MANIFEST_PARSED,
      );
      const lastPublication = () => {
        const calls = mockManifestChangedEmitter.fire.mock.calls;
        const publication = calls[calls.length - 1]?.[0].added?.[0];
        if (!publication) {
          throw new Error("Expected a published manifest event");
        }
        return publication;
      };
      onCall![1](parsedManifest);
      const firstPublication = lastPublication();
      onCall![1](parsedManifest);
      const secondPublication = lastPublication();

      expect(firstPublication).toEqual(
        expect.objectContaining({
          project: dbtProject,
          ...parsedManifest,
          metadataProducer: "manifest",
        }),
      );
      expect(secondPublication.publicationEpoch).toBe(
        firstPublication.publicationEpoch + 1,
      );
      expect(dbtProject.getPublicationEpoch()).toBe(
        secondPublication.publicationEpoch,
      );
    });
  });

  describe("Diagnostics", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
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

      (mockProjectIntegration.getDiagnostics as jest.Mock).mockReturnValue({
        rebuildManifestDiagnostics: [mockDiagnosticData],
        projectConfigDiagnostics: [],
      });

      const diagnostics = dbtProject.getAllDiagnostic();

      expect(diagnostics).toHaveLength(1);
      // Check the diagnostic properties instead of checking if constructor was called
      expect(diagnostics[0]).toMatchObject({
        message: mockDiagnosticData.message,
        severity: vscode.DiagnosticSeverity.Error,
      });
    });

    it("should update diagnostics in problems panel", () => {
      const mockDiagnosticData: DBTDiagnosticData = {
        message: "Test diagnostic",
        severity: "warning",
        filePath: "/test/file.sql",
        source: "dbt",
        category: "warning",
      };

      (mockProjectIntegration.getDiagnostics as jest.Mock).mockReturnValue({
        rebuildManifestDiagnostics: [mockDiagnosticData],
        projectConfigDiagnostics: [mockDiagnosticData],
      });

      dbtProject.updateDiagnosticsInProblemsPanel();

      expect(dbtProject.rebuildManifestDiagnostics.set).toHaveBeenCalled();
      expect(dbtProject.projectConfigDiagnostics.set).toHaveBeenCalled();
    });
  });

  describe("Query Execution", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should compile query", async () => {
      const mockCompiledSQL = "SELECT col1 FROM table";

      mockProjectIntegration.unsafeCompileQuery.mockResolvedValue(
        mockCompiledSQL,
      );

      const result = await dbtProject.compileQuery(
        "SELECT col1 FROM {{ ref('table') }}",
      );

      expect(result).toEqual(mockCompiledSQL);
      expect(mockProjectIntegration.unsafeCompileQuery).toHaveBeenCalledWith(
        "SELECT col1 FROM {{ ref('table') }}",
      );
    });

    it("should get column values", async () => {
      const mockColumnValues = ["value1", "value2"];

      mockProjectIntegration.getColumnValues.mockReturnValue(mockColumnValues);

      const result = await dbtProject.getColumnValues("model", "col");

      expect(result).toEqual(mockColumnValues);
      expect(mockProjectIntegration.getColumnValues).toHaveBeenCalledWith(
        "model",
        "col",
      );
    });
  });

  describe("Column Operations", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should get columns of model", async () => {
      const mockColumns = [
        { name: "col1", type: "varchar" },
        { name: "col2", type: "integer" },
      ];

      // Mock getColumnsOfModel method returns the columns directly
      mockProjectIntegration.getColumnsOfModel.mockImplementation(() =>
        Promise.resolve(mockColumns),
      );

      const result = await dbtProject.getColumnsOfModel("model.test.my_model");

      expect(result).toEqual(mockColumns);
      expect(mockProjectIntegration.getColumnsOfModel).toHaveBeenCalledWith(
        "model.test.my_model",
      );
    });

    it("should get columns of source", async () => {
      const mockColumns = [{ name: "col1", type: "varchar" }];

      // Mock getColumnsOfSource method
      mockProjectIntegration.getColumnsOfSource.mockImplementation(() =>
        Promise.resolve(mockColumns),
      );

      const result = await dbtProject.getColumnsOfSource(
        "my_source",
        "my_table",
      );

      expect(result).toEqual(mockColumns);
      expect(mockProjectIntegration.getColumnsOfSource).toHaveBeenCalledWith(
        "my_source",
        "my_table",
      );
    });
  });

  describe("Disposal", () => {
    it("should dispose all resources properly", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      // Initialize to ensure dbtProjectLog is added to disposables
      await dbtProject.initialize();

      const rebuildManifestDiagnosticsDispose = jest.spyOn(
        dbtProject.rebuildManifestDiagnostics,
        "dispose",
      );
      const projectConfigDiagnosticsDispose = jest.spyOn(
        dbtProject.projectConfigDiagnostics,
        "dispose",
      );

      await dbtProject.dispose();

      expect(rebuildManifestDiagnosticsDispose).toHaveBeenCalled();
      expect(projectConfigDiagnosticsDispose).toHaveBeenCalled();
      expect(mockProjectIntegration.dispose).toHaveBeenCalled();
      // dbtProjectLog is created in constructor and added to disposables in initialize
      expect(mockDbtProjectLog.dispose).toHaveBeenCalled();
    });
  });

  describe("queued command run_results", () => {
    let targetDir: string;

    beforeEach(() => {
      targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-project-run-"));
      mockProjectIntegration.getTargetPath.mockReturnValue(targetDir);
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

    it("records fresh run_results before surfacing Encountered an error", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
      const runResultsHandler = jest.fn();
      dbtProject.onRunResults(runResultsHandler);

      const mockCommand = {
        execute: jest.fn(() => {
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

      (
        dbtProject as unknown as { addCommandToQueue: Function }
      ).addCommandToQueue(mockCommand);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockCommand.execute).toHaveBeenCalled();
      expect(mockRunHistoryService.addEntry).toHaveBeenCalledWith(
        expect.objectContaining({ id: "inv-1", projectName: "test-project" }),
      );
      expect(runResultsHandler).toHaveBeenCalledWith(
        expect.objectContaining({ uniqueIds: ["model.test.model1"] }),
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

    it("reads defer.perProject scoped to the project root", async () => {
      const projectUri = vscode.Uri.file("/test/workspace/finance_general");
      const workspaceFolder = {
        uri: vscode.Uri.file("/test/workspace"),
        name: "Test Workspace",
        index: 0,
      };
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
        workspaceFolder,
      );

      const storedDeferConfig = {
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "/tmp/manifest.json",
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(
        () => ({
          get: jest.fn((key: string) => {
            if (key === "defer.perProject") {
              return { finance_general: storedDeferConfig };
            }
            if (key === "query.limit") {
              return 500;
            }
            return undefined;
          }),
          has: jest.fn(),
          update: jest.fn(),
        }),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(dbtProject.getDeferConfig()).toEqual({
        deferToProduction: true,
        favorState: false,
        manifestPath: path.resolve("/tmp/manifest.json"),
      });
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
        CONFIGURATION_SECTION,
        projectUri,
      );
    });

    it("resolves a relative manifestPathForDeferral against the project root", async () => {
      const projectUri = vscode.Uri.file("/test/workspace/finance_general");
      const workspaceFolder = {
        uri: vscode.Uri.file("/test/workspace"),
        name: "Test Workspace",
        index: 0,
      };
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
        workspaceFolder,
      );

      const storedDeferConfig = {
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "state",
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(
        () => ({
          get: jest.fn((key: string) => {
            if (key === "defer.perProject") {
              return { finance_general: storedDeferConfig };
            }
            if (key === "query.limit") {
              return 500;
            }
            return undefined;
          }),
          has: jest.fn(),
          update: jest.fn(),
        }),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(dbtProject.getDeferConfig()?.manifestPath).toBe(
        path.join(projectUri.fsPath, "state"),
      );
    });

    it("does not honor a remote manifestPathType or hosted integration id from settings", async () => {
      const projectUri = vscode.Uri.file("/test/workspace/finance_general");
      const workspaceFolder = {
        uri: vscode.Uri.file("/test/workspace"),
        name: "Test Workspace",
        index: 0,
      };
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
        workspaceFolder,
      );

      // Not part of the settings schema, but exercised in case a user's settings.json sets it directly.
      const storedDeferConfig = {
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "/tmp/manifest.json",
        manifestPathType: "remote",
        dbtCoreIntegrationId: 42,
      };
      (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(
        () => ({
          get: jest.fn((key: string) => {
            if (key === "defer.perProject") {
              return { finance_general: storedDeferConfig };
            }
            if (key === "query.limit") {
              return 500;
            }
            return undefined;
          }),
          has: jest.fn(),
          update: jest.fn(),
        }),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(dbtProject.getDeferConfig()).toEqual({
        deferToProduction: true,
        favorState: false,
        manifestPath: path.resolve("/tmp/manifest.json"),
      });
    });

    it("does not parse run_results when execute rejects", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      const mockCommand = {
        execute: jest.fn(() => {
          writeRunResults();
          return Promise.reject(new Error("cancelled"));
        }),
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      (
        dbtProject as unknown as { addCommandToQueue: Function }
      ).addCommandToQueue(mockCommand);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockRunHistoryService.addEntry).not.toHaveBeenCalled();
      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select my_model",
        "Error: cancelled",
      );
    });
  });

  describe("Fusion CLI operation routing", () => {
    function buildProject(): DBTProject {
      const projectUri = vscode.Uri.file("/test/project");
      return new DBTProject(
        dbtProjectLogFactory as any,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    }

    function queued() {
      const execute = jest.fn(() => Promise.resolve({ stdout: "" }));
      mockFusionCli.prepare.mockImplementation(() => ({
        execute,
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt",
      }));
      dbtProject = buildProject();
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
        queued();
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
      queued();

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
      const execute = queued();

      await dbtProject.compileModel({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(execute).toHaveBeenCalled();
    });

    it("logs a preparation failure instead of rejecting", async () => {
      dbtProject = buildProject();
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
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key: string) =>
          key === "run.additionalParams" ? ["--full-refresh"] : undefined,
        ),
        has: jest.fn(),
        update: jest.fn(),
      });
      dbtProject = buildProject();
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

    it("routes clean and installDeps through the Fusion project integration", async () => {
      dbtProject = buildProject();
      mockProjectIntegration.clean = jest.fn(() => Promise.resolve());
      mockProjectIntegration.installDeps = jest.fn(() => Promise.resolve());

      dbtProject.clean();
      await dbtProject.installDeps();

      expect(mockProjectIntegration.clean).toHaveBeenCalled();
      expect(mockProjectIntegration.installDeps).toHaveBeenCalled();
    });
  });
});
