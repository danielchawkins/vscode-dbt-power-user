import {
  Catalog,
  DBT_PROJECT_FILE,
  DBTCommandExecutionInfrastructure,
  DBTCommandFactory,
  DBTDiagnosticData,
  DBTProjectIntegrationAdapterEvents,
  DBTTerminal,
  MANIFEST_FILE,
  NoCredentialsError,
  ParsedManifest,
  RESOURCE_TYPE_MODEL,
  RunResultsEventData,
} from "@altimateai/dbt-integration";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { EventEmitter } from "events";
import * as path from "path";
import * as vscode from "vscode";
import { AltimateRequest } from "../../altimate";
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectLog } from "../../dbt_client/dbtProjectLog";
import { ManifestCacheChangedEvent } from "../../dbt_client/event/manifestCacheChangedEvent";
import { PythonEnvironment } from "../../dbt_client/pythonEnvironment";
import { RunHistoryService } from "../../services/runHistoryService";
import { SharedStateService } from "../../services/sharedStateService";
import { ValidationProvider } from "../../validation_provider";

describe("DBTProject Test Suite", () => {
  let mockTerminal: jest.Mocked<DBTTerminal>;
  let mockAltimate: jest.Mocked<AltimateRequest>;
  let mockValidationProvider: jest.Mocked<ValidationProvider>;
  let mockPythonEnvironment: jest.Mocked<PythonEnvironment>;
  let mockSharedStateService: jest.Mocked<SharedStateService>;
  let mockRunHistoryService: jest.Mocked<RunHistoryService>;
  let mockExecutionInfrastructure: jest.Mocked<DBTCommandExecutionInfrastructure>;
  let mockCommandFactory: jest.Mocked<DBTCommandFactory>;
  let mockProjectIntegration: any;
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
        if (key === "queryLimit") {
          return 500;
        }
        if (key === "deferConfigPerProject") {
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

    // Mock AltimateRequest
    mockAltimate = {
      enabled: jest.fn().mockReturnValue(true),
      isAuthenticated: jest.fn().mockReturnValue(true),
      validateCredentials: jest.fn(),
      getAIKey: jest.fn().mockReturnValue("test-ai-key"),
      getInstanceName: jest.fn().mockReturnValue("test-instance"),
      getAltimateUrl: jest.fn().mockReturnValue("https://test.altimate.ai"),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<AltimateRequest>;

    // Mock ValidationProvider
    mockValidationProvider = {
      validateCredentialsSilently: jest.fn(),
    } as unknown as jest.Mocked<ValidationProvider>;

    // Mock PythonEnvironment
    mockPythonEnvironment = {
      initialize: jest.fn(() => Promise.resolve()),
      onPythonEnvironmentChanged: jest.fn().mockReturnValue({
        dispose: jest.fn(),
      }),
    } as unknown as jest.Mocked<PythonEnvironment>;

    // Mock SharedStateService
    mockSharedStateService = {} as unknown as jest.Mocked<SharedStateService>;

    // Mock RunHistoryService
    mockRunHistoryService = {
      addEntry: jest.fn(),
    } as unknown as jest.Mocked<RunHistoryService>;

    // Mock DBTCommandExecutionInfrastructure
    mockExecutionInfrastructure = {
      createPythonBridge: jest.fn().mockImplementation(() => ({
        ex: jest.fn(),
        lock: jest.fn(),
        pid: 1234,
        end: jest.fn(),
        disconnect: jest.fn(),
        kill: jest.fn(),
        ex_json: jest.fn(),
        exNB: jest.fn(),
        exAsync: jest.fn(),
        runJupyterKernel: jest.fn(),
        stdin: null,
        stdout: null,
        stderr: null,
        connected: true,
      })),
      closePythonBridge: jest.fn(),
    } as unknown as jest.Mocked<DBTCommandExecutionInfrastructure>;

    // Mock DBTCommandFactory
    mockCommandFactory = {
      createDocsGenerateCommand: jest.fn().mockReturnValue({
        focus: false,
        logToTerminal: false,
        showProgress: false,
      }),
    } as unknown as jest.Mocked<DBTCommandFactory>;

    // Mock DBTProjectIntegrationAdapter with EventEmitter functionality
    const integrationEventEmitter = new EventEmitter();
    mockProjectIntegration = {
      on: jest.fn().mockImplementation((event: any, listener: any) => {
        integrationEventEmitter.on(event, listener);
      }),
      emit: jest.fn().mockImplementation((event: any, ...args: any) => {
        integrationEventEmitter.emit(event, ...args);
      }),
      getCurrentProjectIntegration: jest.fn(() => mockProjectIntegration),
      cleanupConnections: jest.fn(),
      getProjectName: jest.fn().mockReturnValue("test-project"),
      getSelectedTarget: jest.fn().mockReturnValue("dev"),
      getTargetNames: jest.fn().mockReturnValue(["dev", "prod"]),
      getColumnsOfModel: jest.fn(() => Promise.resolve([])),
      getColumnsOfSource: jest.fn(() => Promise.resolve([])),
      getCatalog: jest.fn(() => Promise.resolve({})),
      unsafeCompileNode: jest.fn(),
      unsafeCompileQuery: jest.fn(),
      runQuery: jest.fn(),
      getColumnValues: jest.fn(),
      unsafeGenerateDocsImmediately: jest.fn(),
      setSelectedTarget: jest.fn(),
      getTargetPath: jest.fn().mockReturnValue("/project/target"),
      getPackageInstallPath: jest.fn().mockReturnValue("/project/dbt_packages"),
      getModelPaths: jest.fn().mockReturnValue(["/project/models"]),
      getSeedPaths: jest.fn().mockReturnValue(["/project/seeds"]),
      getMacroPaths: jest.fn().mockReturnValue(["/project/macros"]),
      getPythonBridgeStatus: jest.fn().mockReturnValue("ready"),
      getDiagnostics: jest.fn().mockReturnValue({
        pythonBridgeDiagnostics: [],
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
    it("should have access to constants from @altimateai/dbt-integration", () => {
      // Verify constants are defined
      expect(DBT_PROJECT_FILE).toBe("dbt_project.yml");
      expect(MANIFEST_FILE).toBe("manifest.json");
      expect(RESOURCE_TYPE_MODEL).toBe("model");
      expect(DBTProjectIntegrationAdapterEvents.SOURCE_FILE_CHANGED).toBe(
        "sourceFileChanged",
      );
    });

    it("should create DBTProject instance with correct configuration", () => {
      const projectUri = vscode.Uri.file("/test/project");
      const projectConfig = {};

      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(dbtProject.projectRoot).toBe(projectUri);
      expect(
        mockValidationProvider.validateCredentialsSilently,
      ).toHaveBeenCalled();
      expect(mockTerminal.debug).toHaveBeenCalledWith(
        "DbtProject",
        expect.stringContaining("Created fusion dbt project"),
      );
    });

    it("should handle validation errors gracefully", () => {
      mockValidationProvider.validateCredentialsSilently.mockImplementation(
        () => {
          throw new NoCredentialsError();
        },
      );

      const projectUri = vscode.Uri.file("/test/project");
      const projectConfig = {};

      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      expect(mockTerminal.error).toHaveBeenCalledWith(
        "validateCredentialsSilently",
        "Credential validation failed",
        expect.any(NoCredentialsError),
        false,
      );
    });

    it("should initialize project integration on initialize()", async () => {
      const projectUri = vscode.Uri.file("/test/project");

      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
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
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
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

    it("should get selected target", () => {
      expect(dbtProject.getSelectedTarget()).toBe("dev");
      expect(mockProjectIntegration.getSelectedTarget).toHaveBeenCalled();
    });

    it("should get target names", () => {
      expect(dbtProject.getTargetNames()).toEqual(["dev", "prod"]);
      expect(mockProjectIntegration.getTargetNames).toHaveBeenCalled();
    });

    it("should set selected target with progress", async () => {
      await dbtProject.setSelectedTarget("prod");

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Changing target...",
          cancellable: false,
        },
        expect.any(Function),
      );
      expect(mockProjectIntegration.setSelectedTarget).toHaveBeenCalledWith(
        "prod",
      );
    });

    it("should get DBT project file path", () => {
      expect(dbtProject.getDBTProjectFilePath()).toBe(
        path.join("/test/project", DBT_PROJECT_FILE),
      );
    });

    it("should get manifest path", () => {
      expect(dbtProject.getManifestPath()).toBe(
        path.join("/project/target", "manifest.json"),
      );
    });

    it("should get catalog path", () => {
      expect(dbtProject.getCatalogPath()).toBe(
        path.join("/project/target", "catalog.json"),
      );
    });

    it("should return undefined for paths when target path is not available", () => {
      mockProjectIntegration.getTargetPath.mockReturnValue(undefined);
      expect(dbtProject.getManifestPath()).toBeUndefined();
      expect(dbtProject.getCatalogPath()).toBeUndefined();
    });
  });

  describe("Event Handling", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
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
          call[0] === DBTProjectIntegrationAdapterEvents.SOURCE_FILE_CHANGED,
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
          call[0] === DBTProjectIntegrationAdapterEvents.MANIFEST_PARSED,
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

    it("should handle run results parsed events", () => {
      const runResultsData: RunResultsEventData = {
        id: "run-1",
        command: "dbt run",
        args: [],
        completedAt: new Date(),
        projectName: "test-project",
        elapsedTime: 0,
        results: [
          { uniqueId: "model.test.model1" } as any,
          { uniqueId: "model.test.model2" } as any,
        ],
      };

      const runResultsHandler = jest.fn();
      dbtProject.onRunResults(runResultsHandler);

      // Trigger the event from the integration
      const onCall = mockProjectIntegration.on.mock.calls.find(
        (call: any) =>
          call[0] === DBTProjectIntegrationAdapterEvents.RUN_RESULTS_PARSED,
      );
      onCall![1](runResultsData);

      expect(mockTerminal.debug).toHaveBeenCalledWith(
        "DBTProject",
        "Received runResultsParsed event from dbtIntegrationAdapter",
      );
    });
  });

  describe("Diagnostics", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
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
        pythonBridgeDiagnostics: [mockDiagnosticData],
        rebuildManifestDiagnostics: [],
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
        pythonBridgeDiagnostics: [mockDiagnosticData],
        rebuildManifestDiagnostics: [mockDiagnosticData],
        projectConfigDiagnostics: [mockDiagnosticData],
      });

      dbtProject.updateDiagnosticsInProblemsPanel();

      expect(dbtProject.pythonBridgeDiagnostics.set).toHaveBeenCalled();
      expect(dbtProject.rebuildManifestDiagnostics.set).toHaveBeenCalled();
      expect(dbtProject.projectConfigDiagnostics.set).toHaveBeenCalled();
    });
  });

  describe("Model Operations", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should compile node", async () => {
      mockProjectIntegration.unsafeCompileNode.mockResolvedValue(
        "-- compiled SQL",
      );

      const result = await dbtProject.compileNode("model.test.my_model");

      expect(result).toBe("-- compiled SQL");
      expect(mockProjectIntegration.unsafeCompileNode).toHaveBeenCalledWith(
        "model.test.my_model",
      );
    });

    it("should handle compile node errors", async () => {
      mockProjectIntegration.unsafeCompileNode.mockRejectedValue(
        new Error("Compile failed"),
      );

      const result = await dbtProject.compileNode("model.test.my_model");

      // When an error occurs, it returns a string with error details
      expect(result).toContain("Detailed error information:");
      // Check that error message was shown to user
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });

    it("should validate SQL", async () => {
      const request = {
        sql: "SELECT * FROM table",
        dialect: "postgres",
        models: [],
      };

      // The real validateSQL requires a working python bridge; here we just
      // verify the wiring: the python bridge is created and closed around the
      // call, even when validation itself surfaces an error.
      await expect(dbtProject.validateSql(request)).rejects.toBeDefined();

      expect(mockExecutionInfrastructure.createPythonBridge).toHaveBeenCalled();
      expect(mockExecutionInfrastructure.closePythonBridge).toHaveBeenCalled();
    });
  });

  describe("Query Execution", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
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
        "test_model",
      );

      expect(result).toEqual(mockCompiledSQL);
      expect(mockProjectIntegration.unsafeCompileQuery).toHaveBeenCalledWith(
        "SELECT col1 FROM {{ ref('table') }}",
        "test_model",
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
      expect(mockProjectIntegration.cleanupConnections).toHaveBeenCalled();
    });
  });

  describe("Catalog Operations", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    });

    it("should get catalog", async () => {
      const mockCatalog: Catalog = {
        nodes: {
          "model.test.my_model": {
            unique_id: "model.test.my_model",
            columns: {
              col1: { name: "col1", type: "varchar" },
            },
          },
        },
      } as any;

      // Mock getCatalog method to return the catalog
      mockProjectIntegration.getCatalog.mockImplementation(() =>
        Promise.resolve(mockCatalog),
      );

      const result = await dbtProject.getCatalog();

      expect(result).toEqual(mockCatalog);
      expect(mockProjectIntegration.getCatalog).toHaveBeenCalled();
      expect(mockProjectIntegration.cleanupConnections).toHaveBeenCalled();
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
      expect(mockProjectIntegration.cleanupConnections).toHaveBeenCalled();
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
      expect(mockProjectIntegration.cleanupConnections).toHaveBeenCalled();
    });
  });

  describe("Disposal", () => {
    it("should dispose all resources properly", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        mockPythonEnvironment,
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        mockExecutionInfrastructure,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockAltimate,
        mockValidationProvider,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      // Initialize to ensure dbtProjectLog is added to disposables
      await dbtProject.initialize();

      const pythonBridgeDiagnosticsDispose = jest.spyOn(
        dbtProject.pythonBridgeDiagnostics,
        "dispose",
      );
      const rebuildManifestDiagnosticsDispose = jest.spyOn(
        dbtProject.rebuildManifestDiagnostics,
        "dispose",
      );
      const projectConfigDiagnosticsDispose = jest.spyOn(
        dbtProject.projectConfigDiagnostics,
        "dispose",
      );

      await dbtProject.dispose();

      expect(pythonBridgeDiagnosticsDispose).toHaveBeenCalled();
      expect(rebuildManifestDiagnosticsDispose).toHaveBeenCalled();
      expect(projectConfigDiagnosticsDispose).toHaveBeenCalled();
      expect(mockProjectIntegration.dispose).toHaveBeenCalled();
      // dbtProjectLog is created in constructor and added to disposables in initialize
      expect(mockDbtProjectLog.dispose).toHaveBeenCalled();
    });
  });
});
