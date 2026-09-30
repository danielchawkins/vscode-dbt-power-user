import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { EventEmitter, Uri } from "vscode";
import { DBTProject } from "../../dbt_client/dbtProject";
import { DBTProjectContainer } from "../../dbt_client/dbtProjectContainer";
import { DBTTerminal } from "../../dbt_integration";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { ProjectRegistry } from "../../projects/projectRegistry";

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
  let project1Manifest: EventEmitter<DBTProject>;
  let project2Manifest: EventEmitter<DBTProject>;

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

    project1Manifest = new EventEmitter<DBTProject>();
    project2Manifest = new EventEmitter<DBTProject>();

    // Mock DBTProject instances
    mockProject1 = {
      projectRoot: Uri.file("/project1"),
      getProjectName: jest.fn().mockReturnValue("project1"),
      getAdapterType: jest.fn().mockReturnValue("snowflake"),
      findPackageName: jest.fn().mockReturnValue("package1"),
      initialize: jest.fn(),
      dispose: jest.fn(),
      onRebuildManifestStatusChange: jest
        .fn()
        .mockReturnValue({ dispose: jest.fn() }),
      manifest: undefined,
      onDidChangeManifest: project1Manifest.event,
      rebuildManifest: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;

    mockProject2 = {
      projectRoot: Uri.file("/project2"),
      getProjectName: jest.fn().mockReturnValue("project2"),
      getAdapterType: jest.fn().mockReturnValue("snowflake"),
      initialize: jest.fn(),
      dispose: jest.fn(),
      onRebuildManifestStatusChange: jest
        .fn()
        .mockReturnValue({ dispose: jest.fn() }),
      manifest: undefined,
      onDidChangeManifest: project2Manifest.event,
      rebuildManifest: jest.fn(),
    } as unknown as jest.Mocked<DBTProject>;

    // Mock factory
    mockDbtProjectFactory = jest.fn((uri: Uri) => {
      const project =
        uri.fsPath === "/project1"
          ? mockProject1
          : uri.fsPath === "/project2"
            ? mockProject2
            : undefined;
      if (!project) {
        throw new Error("Unknown project");
      }
      return project;
    }) as any;

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

    it("should fire project removed before disposing removed projects", async () => {
      const removedHandler = jest.fn();
      container.onDidRemoveProject(removedHandler);

      // Reduce registry to one project
      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removedHandler).toHaveBeenCalledWith(mockProject2.projectRoot);
      expect(mockProject2.dispose).toHaveBeenCalled();
      expect(removedHandler.mock.invocationCallOrder[0]).toBeLessThan(
        (mockProject2.dispose as jest.Mock).mock.invocationCallOrder[0],
      );
    });

    it("fires the removed project's root on onDidRemoveProject", async () => {
      const removedHandler = jest.fn();
      container.onDidRemoveProject(removedHandler);

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removedHandler).toHaveBeenCalledTimes(1);
      expect(removedHandler).toHaveBeenCalledWith(mockProject2.projectRoot);
    });

    it("aggregates onDidChangeManifest across projects and stops after removal", async () => {
      const changedHandler = jest.fn();
      container.onDidChangeManifest(changedHandler);

      project1Manifest.fire(mockProject1);
      project2Manifest.fire(mockProject2);
      expect(changedHandler.mock.calls).toEqual([
        [mockProject1],
        [mockProject2],
      ]);

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      project2Manifest.fire(mockProject2);

      expect(changedHandler).toHaveBeenCalledTimes(2);
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

    it("should fire project removed on disposal", () => {
      const removedHandler = jest.fn<(root: Uri) => void>();
      container.onDidRemoveProject(removedHandler);

      container.dispose();

      expect(removedHandler).toHaveBeenCalledTimes(2);
      const roots = removedHandler.mock.calls.map(([root]) => root.fsPath);
      expect(roots).toContain(mockProject1.projectRoot.fsPath);
      expect(roots).toContain(mockProject2.projectRoot.fsPath);
    });
  });

  describe("metadata source integration", () => {
    beforeEach(async () => {
      await container.initializeDBTProjects();
    });

    it("routes each publication once and drops events after removal", async () => {
      const changed = jest.fn<(project: DBTProject) => void>();
      const removed = jest.fn<(root: Uri) => void>();
      const sourceDispose = jest.spyOn(
        ManifestMetadataSource.prototype,
        "dispose",
      );
      container.onDidChangeManifest(changed);
      container.onDidRemoveProject(removed);

      project1Manifest.fire(mockProject1);

      expect(changed).toHaveBeenCalledTimes(1);
      expect(changed.mock.calls[0]?.[0]).toBe(mockProject1);

      mockProjectRegistry.projects = [declaredProject2];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(removed).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledWith(mockProject1.projectRoot);
      expect(removed.mock.invocationCallOrder[0]).toBeLessThan(
        sourceDispose.mock.invocationCallOrder[0],
      );
      expect(sourceDispose).toHaveBeenCalledTimes(1);

      project1Manifest.fire(mockProject1);
      expect(changed).toHaveBeenCalledTimes(1);

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
