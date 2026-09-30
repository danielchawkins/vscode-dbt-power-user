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
import { EventEmitter, Uri } from "vscode";
import { DBTTerminal } from "../../dbt_integration";
import { ManifestMetadataSource } from "../../metadata/manifestMetadataSource";
import { Project } from "../../projects/project";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { Projects } from "../../projects/projects";

describe("Projects", () => {
  let projects: Projects;
  let mockDbtTerminal: Mocked<DBTTerminal>;
  let mockProjectRegistry: any;
  let mockDbtProjectFactory: Mock;
  let mockProject1: Mocked<Project>;
  let mockProject2: Mocked<Project>;
  let declaredProject1: any;
  let declaredProject2: any;
  let registryOnDidChangeProjects: EventEmitter<void>;
  let project1Manifest: EventEmitter<Project>;
  let project2Manifest: EventEmitter<Project>;

  beforeEach(() => {
    // Mock DBTTerminal
    mockDbtTerminal = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Mocked<DBTTerminal>;

    // Create mock declared projects
    declaredProject1 = {
      root: Uri.file("/project1"),
      name: "project1",
      folder: { uri: Uri.file("/ws"), name: "ws", index: 0 },
      contains: vi.fn((uri: Uri) => uri.fsPath.startsWith("/project1")),
      dispose: vi.fn(),
    };

    declaredProject2 = {
      root: Uri.file("/project2"),
      name: "project2",
      folder: { uri: Uri.file("/ws"), name: "ws", index: 0 },
      contains: vi.fn((uri: Uri) => uri.fsPath.startsWith("/project2")),
      dispose: vi.fn(),
    };

    project1Manifest = new EventEmitter<Project>();
    project2Manifest = new EventEmitter<Project>();

    // Mock Project instances
    mockProject1 = {
      projectRoot: Uri.file("/project1"),
      getProjectName: vi.fn().mockReturnValue("project1"),
      getAdapterType: vi.fn().mockReturnValue("snowflake"),
      initialize: vi.fn(),
      dispose: vi.fn(),
      manifest: undefined,
      onDidChangeManifest: project1Manifest.event,
      rebuildManifest: vi.fn(),
    } as unknown as Mocked<Project>;

    mockProject2 = {
      projectRoot: Uri.file("/project2"),
      getProjectName: vi.fn().mockReturnValue("project2"),
      getAdapterType: vi.fn().mockReturnValue("snowflake"),
      initialize: vi.fn(),
      dispose: vi.fn(),
      manifest: undefined,
      onDidChangeManifest: project2Manifest.event,
      rebuildManifest: vi.fn(),
    } as unknown as Mocked<Project>;

    // Mock factory
    mockDbtProjectFactory = vi.fn((uri: Uri) => {
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
      findProject: vi.fn((uri: Uri) => {
        if (uri.fsPath.startsWith("/project1")) {
          return declaredProject1;
        }
        if (uri.fsPath.startsWith("/project2")) {
          return declaredProject2;
        }
        return undefined;
      }),
      dispose: vi.fn(),
    } as unknown as ProjectRegistry;

    projects = new Projects(
      mockProjectRegistry,
      mockDbtProjectFactory as any,
      mockDbtTerminal,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("initialization and sync", () => {
    it("should construct Project instances exactly once across multiple syncs", async () => {
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

      const initHandler = vi.fn();
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
      const removedHandler = vi.fn();
      projects.onDidRemoveProject(removedHandler);

      // Reduce registry to one project
      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removedHandler).toHaveBeenCalledWith(mockProject2.projectRoot);
      expect(mockProject2.dispose).toHaveBeenCalled();
      expect(removedHandler.mock.invocationCallOrder[0]).toBeLessThan(
        (mockProject2.dispose as Mock).mock.invocationCallOrder[0],
      );
    });

    it("fires the removed project's root on onDidRemoveProject", async () => {
      const removedHandler = vi.fn();
      projects.onDidRemoveProject(removedHandler);

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removedHandler).toHaveBeenCalledTimes(1);
      expect(removedHandler).toHaveBeenCalledWith(mockProject2.projectRoot);
    });

    it("aggregates onDidChangeManifest across projects and stops after removal", async () => {
      const changedHandler = vi.fn();
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
      const removedHandler = vi.fn<(root: Uri) => void>();
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
      const changed = vi.fn<(project: Project) => void>();
      const removed = vi.fn<(root: Uri) => void>();
      const sourceDispose = vi.spyOn(
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
        dispose: vi.fn(),
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
