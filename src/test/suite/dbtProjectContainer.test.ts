import { DBTTerminal, RunModelType } from "@altimateai/dbt-integration";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import { EventEmitter, ExtensionContext, Uri, window } from "vscode";
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import {
  ManifestCacheChangedEvent,
  ManifestCacheProjectAddedEvent,
} from "../../dbt_client/event/manifestCacheChangedEvent";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { createEntry } from "../fixtures/runHistory";

describe("DBTProjectContainer", () => {
  let container: DBTProjectContainer;
  let mockDbtTerminal: jest.Mocked<DBTTerminal>;
  let mockProjectRegistry: any;
  let mockDbtProjectFactory: jest.Mock;
  let mockProject1: jest.Mocked<DBTProject>;
  let mockProject2: jest.Mocked<DBTProject>;
  let declaredProject1: any;
  let declaredProject2: any;
  let registryOnDidChangeProjects: EventEmitter<void>;

  beforeEach(() => {
    // Mock DBTTerminal
    mockDbtTerminal = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<DBTTerminal>;

    // Create mock declared projects
    declaredProject1 = {
      root: Uri.file("/project1"),
      name: "project1",
      folder: { uri: Uri.file("/ws"), name: "ws", index: 0 },
      contains: jest.fn((uri: Uri) => uri.fsPath.startsWith("/project1")),
      dispose: jest.fn(),
    };

    declaredProject2 = {
      root: Uri.file("/project2"),
      name: "project2",
      folder: { uri: Uri.file("/ws"), name: "ws", index: 0 },
      contains: jest.fn((uri: Uri) => uri.fsPath.startsWith("/project2")),
      dispose: jest.fn(),
    };

    // Mock DBTProject instances
    mockProject1 = {
      projectRoot: Uri.file("/project1"),
      getProjectName: jest.fn().mockReturnValue("project1"),
      getAdapterType: jest.fn().mockReturnValue("snowflake"),
      findPackageName: jest.fn().mockReturnValue("package1"),
      initialize: jest.fn(),
      dispose: jest.fn(),
      executeSQLOnQueryPanel: jest.fn(),
      runModel: jest.fn(),
      buildModel: jest.fn(),
      buildProject: jest.fn(),
      runTest: jest.fn(),
      runModelTest: jest.fn(),
      compileModel: jest.fn(),
      compileQuery: jest.fn(async () => "compiled query"),
      showRunSQL: jest.fn(),
      showCompiledSql: jest.fn(),
      generateSchemaYML: jest.fn(),
      onRebuildManifestStatusChange: jest
        .fn()
        .mockReturnValue({ dispose: jest.fn() }),
      getMetadataSnapshot: jest.fn().mockReturnValue(undefined),
      onManifestChanged: new EventEmitter().event,
      rebuildManifest: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;

    mockProject2 = {
      projectRoot: Uri.file("/project2"),
      getProjectName: jest.fn().mockReturnValue("project2"),
      getAdapterType: jest.fn().mockReturnValue("snowflake"),
      initialize: jest.fn(),
      dispose: jest.fn(),
      executeSQLOnQueryPanel: jest.fn(),
      onRebuildManifestStatusChange: jest
        .fn()
        .mockReturnValue({ dispose: jest.fn() }),
      getMetadataSnapshot: jest.fn().mockReturnValue(undefined),
      onManifestChanged: new EventEmitter().event,
      rebuildManifest: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;

    // Mock factory
    mockDbtProjectFactory = jest.fn(
      (uri: Uri, manifestEmitter: EventEmitter<ManifestCacheChangedEvent>) => {
        const project =
          uri.fsPath === "/project1"
            ? mockProject1
            : uri.fsPath === "/project2"
              ? mockProject2
              : undefined;
        if (!project) {
          throw new Error("Unknown project");
        }
        Object.defineProperty(project, "onManifestChanged", {
          configurable: true,
          value: manifestEmitter.event,
        });
        return project;
      },
    ) as any;

    // Mock ProjectRegistry
    registryOnDidChangeProjects = new EventEmitter<void>();
    mockProjectRegistry = {
      projects: [declaredProject1, declaredProject2],
      get onDidChangeProjects() {
        return registryOnDidChangeProjects.event;
      },
      findProject: jest.fn((uri: Uri) => {
        if (uri.fsPath.startsWith("/project1")) {
          return declaredProject1;
        }
        if (uri.fsPath.startsWith("/project2")) {
          return declaredProject2;
        }
        return undefined;
      }),
      dispose: jest.fn(),
    } as unknown as ProjectRegistry;

    container = new DBTProjectContainer(
      mockProjectRegistry,
      mockDbtProjectFactory as any,
      mockDbtTerminal,
    );
    jest
      .spyOn(fs.realpathSync, "native")
      .mockImplementation((value) => value as string);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("initialization and sync", () => {
    it("should construct DBTProject instances exactly once across multiple syncs", async () => {
      await container.initializeDBTProjects();

      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
      expect(mockProject1.initialize).toHaveBeenCalled();
      expect(mockProject2.initialize).toHaveBeenCalled();

      // Trigger a second sync via registry change
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      // Factory should not be called again
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("should initialize event even when no projects exist", async () => {
      mockProjectRegistry.projects = [];
      const container2 = new DBTProjectContainer(
        mockProjectRegistry,
        mockDbtProjectFactory as any,
        mockDbtTerminal,
      );

      const initHandler = jest.fn();
      container2.onDBTProjectsInitialization(initHandler);

      await container2.initializeDBTProjects();

      expect(initHandler).toHaveBeenCalled();
    });
  });

  describe("project lookup", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("should resolve projects through registry with deepest-first order", () => {
      const project = container.findDBTProject(
        Uri.file("/project1/models/my_model.sql"),
      );
      expect(project).toBe(mockProject1);
    });

    it("should return registry order for getProjects", () => {
      const projects = container.getProjects();
      expect(projects).toHaveLength(2);
      expect(projects[0]).toBe(mockProject1);
      expect(projects[1]).toBe(mockProject2);
    });

    it("should return undefined for file outside any project", () => {
      const project = container.findDBTProject(Uri.file("/unknown/path"));
      expect(project).toBeUndefined();
    });
  });

  describe("removal and manifest events", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("should fire manifest removed before disposing removed projects", async () => {
      const manifestHandler = jest.fn();
      container.onManifestChanged(manifestHandler);

      // Reduce registry to one project
      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(manifestHandler).toHaveBeenCalledWith({
        removed: [{ projectRoot: mockProject2.projectRoot }],
      });
      expect(mockProject2.dispose).toHaveBeenCalled();
      expect(manifestHandler.mock.invocationCallOrder[0]).toBeLessThan(
        (mockProject2.dispose as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it("should update rebuild status map on removal", async () => {
      const statusHandler = jest.fn();
      container.onRebuildManifestStatusChange(statusHandler);

      // Manually trigger rebuild status for project2
      const rebuildStatusSub = (
        mockProject2.onRebuildManifestStatusChange as jest.Mock
      ).mock.calls[0]?.[0] as any;
      if (rebuildStatusSub && typeof rebuildStatusSub === "function") {
        rebuildStatusSub({
          project: mockProject2,
          inProgress: true,
        });
      }

      // Remove project2
      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(statusHandler).toHaveBeenLastCalledWith({
        projects: [],
        inProgress: false,
      });
    });
  });

  describe("registry reconciliation", () => {
    it("should follow registry order changes", async () => {
      await container.initializeDBTProjects();
      mockProjectRegistry.projects = [declaredProject2, declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(container.getProjects()).toEqual([mockProject2, mockProject1]);
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("serializes removal after project initialization", async () => {
      mockProjectRegistry.projects = [];
      await container.initializeDBTProjects();
      let finish!: () => void;
      mockProject1.initialize.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      mockProjectRegistry.projects = [];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockProject1.dispose).not.toHaveBeenCalled();
      finish();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockProject1.dispose).toHaveBeenCalled();
    });

    it("reports reconciliation failures", async () => {
      mockProjectRegistry.projects = [];
      await container.initializeDBTProjects();
      mockProject1.initialize.mockRejectedValue(new Error("broken project"));

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDbtTerminal.error).toHaveBeenCalledWith(
        "DBTProjectContainer",
        "Project synchronization failed",
        expect.any(Error),
      );
    });
  });

  describe("retained container API", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("exposes context state", async () => {
      const context = {
        extensionUri: Uri.file("/extension"),
        extension: { id: "publisher.extension", packageJSON: { version: "1" } },
        workspaceState: { get: jest.fn(), update: jest.fn() },
        globalState: { get: jest.fn(), update: jest.fn() },
      } as unknown as ExtensionContext;
      container.setContext(context);

      expect(container.extensionUri).toBe(context.extensionUri);
      expect(container.extensionVersion).toBe("1");
      expect(container.extensionId).toBe("publisher.extension");
    });

    it("initializes every project and awaits completion", async () => {
      let finish!: () => void;
      mockProject1.initialize.mockReturnValue(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      mockProject1.initialize.mockClear();
      mockProject2.initialize.mockClear();

      const result = container.initialize();
      expect(mockProject1.initialize).toHaveBeenCalled();
      expect(mockProject2.initialize).toHaveBeenCalled();
      finish();
      await result;
    });

    it("resolves package, root, adapter, and project-name accessors", () => {
      const model = Uri.file("/project1/models/test.sql");

      expect(container.getPackageName(model)).toBe("package1");
      expect(container.getProjectRootpath(model)).toBe(
        mockProject1.projectRoot,
      );
      expect(container.getAdapters()).toEqual(["snowflake"]);
      expect(container.findProjectByName("project2")).toBe(mockProject2);
    });

    it("delegates SQL and display operations", async () => {
      const model = Uri.file("/project1/models/test.sql");

      container.executeSQL(model, "select 1", "test");
      await expect(container.compileQuery(model, "select 1")).resolves.toBe(
        "compiled query",
      );
      container.showRunSQL(model);
      container.showCompiledSQL(model);

      expect(mockProject1.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 1",
        "test",
      );
      expect(mockProject1.compileQuery).toHaveBeenCalledWith("select 1");
      expect(mockProject1.showRunSQL).toHaveBeenCalledWith(model);
      expect(mockProject1.showCompiledSql).toHaveBeenCalledWith(model);
    });

    it.each([
      {
        name: "run",
        invoke: () => container.runModel(Uri.file("/project1/models/test.sql")),
        method: () => mockProject1.runModel,
        expected: {
          plusOperatorLeft: "",
          modelName: "test",
          plusOperatorRight: "",
        },
      },
      {
        name: "run with parents",
        invoke: () =>
          container.runModel(
            Uri.file("/project1/models/test.sql"),
            RunModelType.RUN_PARENTS,
          ),
        method: () => mockProject1.runModel,
        expected: {
          plusOperatorLeft: "+",
          modelName: "test",
          plusOperatorRight: "",
        },
      },
      {
        name: "run with children",
        invoke: () =>
          container.runModel(
            Uri.file("/project1/models/test.sql"),
            RunModelType.RUN_CHILDREN,
          ),
        method: () => mockProject1.runModel,
        expected: {
          plusOperatorLeft: "",
          modelName: "test",
          plusOperatorRight: "+",
        },
      },
      {
        name: "build with parents",
        invoke: () =>
          container.buildModel(
            Uri.file("/project1/models/test.sql"),
            RunModelType.BUILD_PARENTS,
          ),
        method: () => mockProject1.buildModel,
        expected: {
          plusOperatorLeft: "+",
          modelName: "test",
          plusOperatorRight: "",
        },
      },
      {
        name: "build with children",
        invoke: () =>
          container.buildModel(
            Uri.file("/project1/models/test.sql"),
            RunModelType.BUILD_CHILDREN,
          ),
        method: () => mockProject1.buildModel,
        expected: {
          plusOperatorLeft: "",
          modelName: "test",
          plusOperatorRight: "+",
        },
      },
      {
        name: "build with parents and children",
        invoke: () =>
          container.buildModel(
            Uri.file("/project1/models/test.sql"),
            RunModelType.BUILD_CHILDREN_PARENTS,
          ),
        method: () => mockProject1.buildModel,
        expected: {
          plusOperatorLeft: "+",
          modelName: "test",
          plusOperatorRight: "+",
        },
      },
    ])(
      "derives selector operators for $name",
      ({ invoke, method, expected }) => {
        invoke();
        expect(method()).toHaveBeenCalledWith(expected);
      },
    );

    it("delegates model, test, and schema operations", () => {
      const model = Uri.file("/project1/models/test.sql");

      container.buildProject(model);
      container.compileModel(model);
      container.generateSchemaYML(model, "test");
      container.runTest(model, "unique_test");
      container.runModelTest(model, "test");
      container.runModelByName(model, "test");

      expect(mockProject1.buildProject).toHaveBeenCalled();
      expect(mockProject1.compileModel).toHaveBeenCalledWith({
        plusOperatorLeft: "",
        modelName: "test",
        plusOperatorRight: "",
      });
      expect(mockProject1.generateSchemaYML).toHaveBeenCalledWith(
        model,
        "test",
      );
      expect(mockProject1.runTest).toHaveBeenCalledWith("unique_test");
      expect(mockProject1.runModelTest).toHaveBeenCalledWith("test");
      expect(mockProject1.runModel).toHaveBeenCalledWith({
        plusOperatorLeft: "",
        modelName: "test",
        plusOperatorRight: "",
      });
    });

    it("reads and writes workspace and global state", () => {
      const workspaceState = {
        get: jest.fn().mockReturnValue("workspace-value"),
        update: jest.fn(),
      };
      const globalState = {
        get: jest.fn().mockReturnValue("global-value"),
        update: jest.fn(),
      };
      container.setContext({
        workspaceState,
        globalState,
      } as unknown as ExtensionContext);

      container.setToWorkspaceState("key", "value");
      container.setToGlobalState("key", "value");

      expect(container.getFromWorkspaceState("key")).toBe("workspace-value");
      expect(container.getFromGlobalState("key")).toBe("global-value");
      expect(workspaceState.update).toHaveBeenCalledWith("key", "value");
      expect(globalState.update).toHaveBeenCalledWith("key", "value");
    });

    it("resolves SQL for files in a project", () => {
      const model = Uri.file("/project1/models/test.sql");

      container.executeSQL(model, "select 1", "test");

      expect(mockProject1.executeSQLOnQueryPanel).toHaveBeenCalledWith(
        "select 1",
        "test",
      );
    });

    it("does not resolve SQL for untitled documents outside any project", () => {
      container.executeSQL(
        { scheme: "untitled", fsPath: "Untitled-1" } as Uri,
        "select 1",
        "untitled",
      );

      expect(mockProject1.executeSQLOnQueryPanel).not.toHaveBeenCalled();
      expect(mockProject2.executeSQLOnQueryPanel).not.toHaveBeenCalled();
    });

    it("returns an empty extension id before context is set", () => {
      expect(container.extensionId).toBe("");
    });
  });

  describe("rerunFromHistory", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("reports a project that is not loaded", () => {
      container.rerunFromHistory(
        createEntry({ projectName: "missing", command: "dbt run" }),
      );

      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("missing"),
      );
    });

    it.each(["dbt run", "dbt test", "dbt compile"])(
      "warns for project-wide %s",
      (command) => {
        container.rerunFromHistory(
          createEntry({ projectName: "project1", command, args: [] }),
        );

        expect(window.showWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining(command),
        );
      },
    );

    it("reruns selected run, test, compile, and build commands", () => {
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt run",
          args: ["model"],
        }),
      );
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt test",
          args: ["unique_model"],
        }),
      );
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt compile",
          args: ["+model"],
        }),
      );
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt build",
          args: ["+model+"],
        }),
      );
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt build",
          args: [],
        }),
      );

      expect(mockProject1.runModel).toHaveBeenCalledWith(
        expect.objectContaining({ modelName: "model" }),
      );
      expect(mockProject1.runTest).toHaveBeenCalledWith("unique_model");
      expect(mockProject1.compileModel).toHaveBeenCalledWith(
        expect.objectContaining({ plusOperatorLeft: "+", modelName: "model" }),
      );
      expect(mockProject1.buildModel).toHaveBeenCalledWith({
        plusOperatorLeft: "+",
        modelName: "model",
        plusOperatorRight: "+",
      });
      expect(mockProject1.buildProject).toHaveBeenCalled();
    });

    it("warns for unsupported commands", () => {
      container.rerunFromHistory(
        createEntry({
          projectName: "project1",
          command: "dbt seed",
          args: [],
        }),
      );

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("seed"),
      );
    });
  });

  describe("disposal", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("should dispose projects and subscriptions but not registry", async () => {
      container.dispose();
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockProject1.dispose).toHaveBeenCalled();
      expect(mockProject2.dispose).toHaveBeenCalled();
      expect(mockProjectRegistry.dispose).not.toHaveBeenCalled();
      expect(container.getProjects()).toEqual([]);
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("should fire manifest removed on disposal", () => {
      const manifestHandler = jest.fn();
      container.onManifestChanged(manifestHandler);

      container.dispose();

      const calls = manifestHandler.mock.calls;
      const removedCalls = calls.filter((call: any) => call[0]?.removed);
      expect(removedCalls).toHaveLength(2);

      const allRemoved = removedCalls.flatMap((call: any) => call[0].removed);
      const roots = allRemoved.map((r: any) => r.projectRoot.fsPath).sort();
      expect(roots).toContain(mockProject1.projectRoot.fsPath);
      expect(roots).toContain(mockProject2.projectRoot.fsPath);
    });
  });

  describe("metadata source integration", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("routes each publication once and drops events after removal", async () => {
      const listener = jest.fn<(event: ManifestCacheChangedEvent) => void>();
      const sourceDispose = jest.spyOn(
        ManifestMetadataSource.prototype,
        "dispose",
      );
      container.onManifestChanged(listener);
      const projectEmitter = mockDbtProjectFactory.mock
        .calls[0][1] as EventEmitter<ManifestCacheChangedEvent>;
      const publication: ManifestCacheProjectAddedEvent = {
        project: mockProject1,
        nodeMetaMap: {} as any,
        macroMetaMap: new Map(),
        metricMetaMap: new Map(),
        sourceMetaMap: new Map(),
        graphMetaMap: {} as any,
        testMetaMap: new Map(),
        unitTestMetaMap: new Map(),
        docMetaMap: new Map(),
        exposureMetaMap: new Map(),
        functionMetaMap: new Map(),
        semanticModelMetaMap: new Map(),
        modelDepthMap: new Map(),
        publicationEpoch: 1,
        metadataProducer: "manifest",
      };

      projectEmitter.fire({ added: [publication] });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0].added?.[0]).toBe(publication);

      mockProjectRegistry.projects = [declaredProject2];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0]).toEqual({
        removed: [{ projectRoot: mockProject1.projectRoot }],
      });
      expect(listener.mock.invocationCallOrder[1]).toBeLessThan(
        sourceDispose.mock.invocationCallOrder[0],
      );
      expect(sourceDispose).toHaveBeenCalledTimes(1);

      projectEmitter.fire({ added: [publication] });
      expect(listener).toHaveBeenCalledTimes(2);

      container.dispose();
      expect(sourceDispose).toHaveBeenCalledTimes(2);
    });

    it("replaces the source when Declared Project identity changes", async () => {
      const replacement = {
        ...declaredProject1,
        name: "renamed-project",
        dispose: jest.fn(),
      };

      mockProjectRegistry.projects = [replacement, declaredProject2];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(3);
      expect(mockProject1.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
