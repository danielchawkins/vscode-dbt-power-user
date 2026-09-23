import {
  Catalog,
  DBT_PROJECT_FILE,
  DBTCommandFactory,
  DBTDiagnosticData,
  DBTTerminal,
  MANIFEST_FILE,
  ManifestPathType,
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
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectLog } from "../../dbt_client/dbtProjectLog";
import { ManifestCacheChangedEvent } from "../../dbt_client/event/manifestCacheChangedEvent";
import { FusionProjectIntegrationEvents } from "../../dbt_client/fusionProjectIntegration";
import { CONFIGURATION_SECTION } from "../../projects/projectConfiguration";
import { RunHistoryService } from "../../services/runHistoryService";
import { SharedStateService } from "../../services/sharedStateService";
describe("DBTProject Test Suite", () => {
  let mockTerminal: jest.Mocked<DBTTerminal>;
  let mockSharedStateService: jest.Mocked<SharedStateService>;
  let mockRunHistoryService: jest.Mocked<RunHistoryService>;
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

    // Mock DBTCommandFactory
    mockCommandFactory = {
      createDocsGenerateCommand: jest.fn().mockReturnValue({
        focus: false,
        logToTerminal: false,
        showProgress: false,
      }),
    } as unknown as jest.Mocked<DBTCommandFactory>;

    // Mock FusionProjectIntegration with EventEmitter functionality
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
      getColumnsOfModel: jest.fn(() => Promise.resolve([])),
      getColumnsOfSource: jest.fn(() => Promise.resolve([])),
      getCatalog: jest.fn(() => Promise.resolve({})),
      unsafeCompileNode: jest.fn(),
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
      observeRunResultsBeforeCommand: jest.fn(() => null),
      parseRunResultsAfterCommand: jest.fn(),
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
      expect(FusionProjectIntegrationEvents.SOURCE_FILE_CHANGED).toBe(
        "sourceFileChanged",
      );
    });

    it("should create DBTProject instance with correct configuration", () => {
      const projectUri = vscode.Uri.file("/test/project");
      const projectConfig = {};

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
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
        mockCommandFactory,
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
        mockCommandFactory,
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
        mockCommandFactory,
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
          call[0] === FusionProjectIntegrationEvents.RUN_RESULTS_PARSED,
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
        dbtProjectLogFactory as any,
        mockCommandFactory,
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

  describe("Model Operations", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
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
  });

  describe("Query Execution", () => {
    beforeEach(() => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
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
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
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
        dbtProjectLogFactory as any,
        mockCommandFactory,
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
    it("parses fresh run_results before surfacing Encountered an error", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
      (
        dbtProject as unknown as { createQueue: (queueName: string) => void }
      ).createQueue("all");

      mockProjectIntegration.observeRunResultsBeforeCommand.mockReturnValue(
        null,
      );
      const mockCommand = {
        execute: jest.fn(() =>
          Promise.resolve({
            stdout: "Encountered an error: model failed",
          }),
        ),
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      (
        dbtProject as unknown as { addCommandToQueue: Function }
      ).addCommandToQueue("all", mockCommand);
      await new Promise((resolve) => setImmediate(resolve));

      expect(
        mockProjectIntegration.observeRunResultsBeforeCommand,
      ).toHaveBeenCalled();
      expect(mockCommand.execute).toHaveBeenCalled();
      expect(
        mockProjectIntegration.parseRunResultsAfterCommand,
      ).toHaveBeenCalledWith(null);
      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select my_model",
        expect.stringContaining("Encountered an error:"),
      );
      const parseOrder =
        mockProjectIntegration.parseRunResultsAfterCommand.mock
          .invocationCallOrder[0];
      const failOrder =
        mockRunHistoryService.notifyCommandFailed.mock.invocationCallOrder[0];
      expect(parseOrder).toBeLessThan(failOrder);
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
      mockProjectIntegration.applyDeferConfig = jest.fn(() =>
        Promise.resolve(),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      await dbtProject.applyDeferConfig();

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
        CONFIGURATION_SECTION,
        projectUri,
      );
      expect(mockProjectIntegration.applyDeferConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          deferToProduction: true,
          favorState: false,
          manifestPathType: ManifestPathType.LOCAL,
        }),
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
      mockProjectIntegration.applyDeferConfig = jest.fn(() =>
        Promise.resolve(),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      await dbtProject.applyDeferConfig();

      expect(mockProjectIntegration.applyDeferConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          manifestPathForDeferral: path.join(projectUri.fsPath, "state"),
          manifestPathType: ManifestPathType.LOCAL,
        }),
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
      mockProjectIntegration.applyDeferConfig = jest.fn(() =>
        Promise.resolve(),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      await dbtProject.applyDeferConfig();

      const appliedConfig =
        mockProjectIntegration.applyDeferConfig.mock.calls[0][0];
      expect(appliedConfig.manifestPathType).toBe(ManifestPathType.LOCAL);
      expect(appliedConfig.dbtCoreIntegrationId).toBeUndefined();
    });

    it("warns in the terminal when defer is enabled without a manifest path", async () => {
      const projectUri = vscode.Uri.file("/test/workspace/finance_general");
      const workspaceFolder = {
        uri: vscode.Uri.file("/test/workspace"),
        name: "Test Workspace",
        index: 0,
      };
      (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(
        workspaceFolder,
      );
      (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(
        () => ({
          get: jest.fn((key: string) => {
            if (key === "defer.perProject") {
              return {
                finance_general: { deferToProduction: true, favorState: false },
              };
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
      mockProjectIntegration.applyDeferConfig = jest.fn(() =>
        Promise.resolve(),
      );

      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );

      await dbtProject.applyDeferConfig();

      expect(mockTerminal.warn).toHaveBeenCalledWith(
        "deferMissingManifestPath",
        expect.stringContaining("fusionPowerUser.defer.perProject"),
        false,
      );
    });

    it("does not parse run_results when execute rejects", async () => {
      const projectUri = vscode.Uri.file("/test/project");
      dbtProject = new DBTProject(
        dbtProjectLogFactory as any,
        mockCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
      (
        dbtProject as unknown as { createQueue: (queueName: string) => void }
      ).createQueue("all");

      const mockCommand = {
        execute: jest.fn(() => Promise.reject(new Error("cancelled"))),
        focus: false,
        showProgress: false,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      (
        dbtProject as unknown as { addCommandToQueue: Function }
      ).addCommandToQueue("all", mockCommand);
      await new Promise((resolve) => setImmediate(resolve));

      expect(
        mockProjectIntegration.parseRunResultsAfterCommand,
      ).not.toHaveBeenCalled();
      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        "dbt run --select my_model",
        "Error: cancelled",
      );
    });
  });

  describe("Fusion CLI operation routing", () => {
    let realCommandFactory: DBTCommandFactory;

    beforeEach(() => {
      realCommandFactory = new DBTCommandFactory({
        getRunModelCommandAdditionalParams: () => [],
        getBuildModelCommandAdditionalParams: () => [],
        getTestModelCommandAdditionalParams: () => [],
      } as unknown as ConstructorParameters<typeof DBTCommandFactory>[0]);
    });

    function buildProject(): DBTProject {
      const projectUri = vscode.Uri.file("/test/project");
      return new DBTProject(
        dbtProjectLogFactory as any,
        realCommandFactory,
        mockTerminal,
        mockSharedStateService,
        jest.fn().mockReturnValue(mockProjectIntegration) as any,
        mockRunHistoryService,
        projectUri,
        mockManifestChangedEmitter,
      );
    }

    it.each([
      ["", "", "run --select my_model"],
      ["+", "", "run --select +my_model"],
      ["", "+", "run --select my_model+"],
      ["+", "+", "run --select +my_model+"],
    ])(
      "builds runModel args for %s my_model %s",
      async (plusOperatorLeft, plusOperatorRight, expectedFragment) => {
        dbtProject = buildProject();
        mockProjectIntegration.runModel = jest.fn(() => Promise.resolve());

        await dbtProject.runModel({
          plusOperatorLeft,
          modelName: "my_model",
          plusOperatorRight,
        });

        const command = mockProjectIntegration.runModel.mock.calls[0][0];
        expect(command.getCommandAsString()).toContain(expectedFragment);
      },
    );

    it.each([
      ["", "", "build --select my_model"],
      ["+", "", "build --select +my_model"],
      ["", "+", "build --select my_model+"],
      ["+", "+", "build --select +my_model+"],
    ])(
      "builds buildModel args for %s my_model %s",
      async (plusOperatorLeft, plusOperatorRight, expectedFragment) => {
        dbtProject = buildProject();
        mockProjectIntegration.buildModel = jest.fn(() => Promise.resolve());

        await dbtProject.buildModel({
          plusOperatorLeft,
          modelName: "my_model",
          plusOperatorRight,
        });

        const command = mockProjectIntegration.buildModel.mock.calls[0][0];
        expect(command.getCommandAsString()).toContain(expectedFragment);
      },
    );

    it("builds buildProject args with no select", async () => {
      dbtProject = buildProject();
      mockProjectIntegration.buildProject = jest.fn(() => Promise.resolve());

      await dbtProject.buildProject();

      const command = mockProjectIntegration.buildProject.mock.calls[0][0];
      expect(command.getCommandAsString()).toContain("build");
      expect(command.getCommandAsString()).not.toContain("--select");
    });

    it("builds runTest and runModelTest args with the test name selector", async () => {
      dbtProject = buildProject();
      mockProjectIntegration.runTest = jest.fn(() => Promise.resolve());
      mockProjectIntegration.runModelTest = jest.fn(() => Promise.resolve());

      await dbtProject.runTest("my_test");
      await dbtProject.runModelTest("my_model");

      expect(
        mockProjectIntegration.runTest.mock.calls[0][0].getCommandAsString(),
      ).toContain("test --select my_test");
      expect(
        mockProjectIntegration.runModelTest.mock.calls[0][0].getCommandAsString(),
      ).toContain("test --select my_model");
    });

    it("compiles a model and queues the resulting command for execution", async () => {
      dbtProject = buildProject();
      (
        dbtProject as unknown as { createQueue: (queueName: string) => void }
      ).createQueue("all");
      (vscode.window.withProgress as jest.Mock).mockImplementationOnce(
        (_options: unknown, task: any) =>
          task(undefined, {
            onCancellationRequested: () => ({ dispose: () => undefined }),
          }),
      );
      const executeSpy = jest.fn(() => Promise.resolve({ stdout: "" }));
      mockProjectIntegration.compileModel = jest.fn(async (command: any) => {
        expect(command.getCommandAsString()).toContain(
          "compile --select my_model",
        );
        command.execute = executeSpy;
        return command;
      });

      await dbtProject.compileModel({
        plusOperatorLeft: "",
        modelName: "my_model",
        plusOperatorRight: "",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(executeSpy).toHaveBeenCalled();
    });

    it("logs a compile failure through prepareAndQueue instead of rejecting", async () => {
      dbtProject = buildProject();
      (
        dbtProject as unknown as { createQueue: (queueName: string) => void }
      ).createQueue("all");
      mockProjectIntegration.compileModel = jest.fn(() =>
        Promise.reject(new Error("compilation failed")),
      );

      await expect(
        dbtProject.compileModel({
          plusOperatorLeft: "",
          modelName: "my_model",
          plusOperatorRight: "",
        }),
      ).resolves.toBeUndefined();

      expect(mockRunHistoryService.notifyCommandFailed).toHaveBeenCalledWith(
        expect.stringContaining("compile --select my_model"),
        "Error: compilation failed",
      );
      expect(mockTerminal.error).toHaveBeenCalledWith(
        "commandPreparationError",
        expect.stringContaining("compile --select my_model"),
        expect.any(Error),
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

    it("propagates progress-token cancellation to the queued command's abort signal", async () => {
      dbtProject = buildProject();
      (
        dbtProject as unknown as { createQueue: (queueName: string) => void }
      ).createQueue("all");

      let capturedCancel: (() => void) | undefined;
      (vscode.window.withProgress as jest.Mock).mockImplementationOnce(
        (_options: unknown, task: any) => {
          const token = {
            onCancellationRequested: (cb: () => void) => {
              capturedCancel = cb;
              return { dispose: () => undefined };
            },
          };
          return task(undefined, token);
        },
      );

      let observedSignal: AbortSignal | undefined;
      const executeSpy = jest.fn((signal?: AbortSignal) => {
        observedSignal = signal;
        return new Promise((resolve) => {
          signal?.addEventListener("abort", () =>
            resolve({ stdout: "" } as any),
          );
        });
      });
      const mockCommand = {
        execute: executeSpy,
        focus: false,
        showProgress: true,
        signal: undefined,
        getCommandAsString: () => "dbt run --select my_model",
      };

      (
        dbtProject as unknown as { addCommandToQueue: Function }
      ).addCommandToQueue("all", mockCommand);
      await Promise.resolve();
      await Promise.resolve();

      expect(executeSpy).toHaveBeenCalled();
      expect(observedSignal?.aborted).toBe(false);

      capturedCancel?.();
      await new Promise((resolve) => setImmediate(resolve));

      expect(observedSignal?.aborted).toBe(true);
    });
  });
});
