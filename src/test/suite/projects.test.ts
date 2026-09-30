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
import { DBTTerminal } from "../../dbt_integration";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { Projects } from "../../projects/projects";

describe("Projects", () => {
  let projects: Projects;
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

    projects = new Projects(
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
      await projects.initialize();

      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
      expect(mockProject1.initialize).toHaveBeenCalled();
      expect(mockProject2.initialize).toHaveBeenCalled();

      // Trigger a second sync via registry change
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      // Factory should not be called again
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("fires onDidInitialize even when no projects exist", async () => {
      mockProjectRegistry.projects = [];
      const other = new Projects(
        mockProjectRegistry,
        mockDbtProjectFactory as any,
        mockDbtTerminal,
      );

      const initHandler = jest.fn();
      other.onDidInitialize(initHandler);

      await other.initialize();

      expect(initHandler).toHaveBeenCalled();
    });
  });

  describe("project lookup", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("should resolve projects through registry with deepest-first order", () => {
      const project = projects.get(Uri.file("/project1/models/my_model.sql"));
      expect(project).toBe(mockProject1);
    });

    it("should return registry order for all", () => {
      const all = projects.all();
      expect(all).toHaveLength(2);
      expect(all[0]).toBe(mockProject1);
      expect(all[1]).toBe(mockProject2);
    });

    it("should return undefined for file outside any project", () => {
      const project = projects.get(Uri.file("/unknown/path"));
      expect(project).toBeUndefined();
    });
  });

  describe("removal and manifest events", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("should fire project removed before disposing removed projects", async () => {
      const removedHandler = jest.fn();
      projects.onDidRemoveProject(removedHandler);

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
      projects.onDidRemoveProject(removedHandler);

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removedHandler).toHaveBeenCalledTimes(1);
      expect(removedHandler).toHaveBeenCalledWith(mockProject2.projectRoot);
    });

    it("aggregates onDidChangeManifest across projects and stops after removal", async () => {
      const changedHandler = jest.fn();
      projects.onDidChangeManifest(changedHandler);

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
      projects.onDidChangeRebuildStatus(statusHandler);

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
      await projects.initialize();
      mockProjectRegistry.projects = [declaredProject2, declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(projects.all()).toEqual([mockProject2, mockProject1]);
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("serializes removal after project initialization", async () => {
      mockProjectRegistry.projects = [];
      await projects.initialize();
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
      await projects.initialize();
      mockProject1.initialize.mockRejectedValue(new Error("broken project"));

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockDbtTerminal.error).toHaveBeenCalledWith(
        "Projects",
        "Project synchronization failed",
        expect.any(Error),
      );
    });
  });

  describe("lookup API", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("ignores a second initialize", async () => {
      mockDbtProjectFactory.mockClear();
      await projects.initialize();
      expect(mockDbtProjectFactory).not.toHaveBeenCalled();
    });

    it("resolves adapter and project-name accessors", () => {
      expect(projects.adapters()).toEqual(["snowflake"]);
      expect(projects.byName("project2")).toBe(mockProject2);
    });
  });

  describe("disposal", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("should dispose projects and subscriptions but not registry", async () => {
      projects.dispose();
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockProject1.dispose).toHaveBeenCalled();
      expect(mockProject2.dispose).toHaveBeenCalled();
      expect(mockProjectRegistry.dispose).not.toHaveBeenCalled();
      expect(projects.all()).toEqual([]);
      expect(mockDbtProjectFactory).toHaveBeenCalledTimes(2);
    });

    it("should fire project removed on disposal", () => {
      const removedHandler = jest.fn<(root: Uri) => void>();
      projects.onDidRemoveProject(removedHandler);

      projects.dispose();

      expect(removedHandler).toHaveBeenCalledTimes(2);
      const roots = removedHandler.mock.calls.map(([root]) => root.fsPath);
      expect(roots).toContain(mockProject1.projectRoot.fsPath);
      expect(roots).toContain(mockProject2.projectRoot.fsPath);
    });
  });

  describe("metadata source integration", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("routes each publication once and drops events after removal", async () => {
      const changed = jest.fn<(project: DBTProject) => void>();
      const removed = jest.fn<(root: Uri) => void>();
      const sourceDispose = jest.spyOn(
        ManifestMetadataSource.prototype,
        "dispose",
      );
      projects.onDidChangeManifest(changed);
      projects.onDidRemoveProject(removed);

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

      projects.dispose();
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
