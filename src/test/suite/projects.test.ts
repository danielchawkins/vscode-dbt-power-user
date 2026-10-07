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
import { EventEmitter, Uri, workspace } from "vscode";
import type { Log } from "../../core/log";
import { emptyParsedManifest } from "../../core/metadata";
import type { ParsedManifest } from "../../dbt_integration/domain";
import { CompositeMetadataSource } from "../../metadata/compositeMetadataSource";
import { Project } from "../../projects/project";
import { Projects } from "../../projects/projects";

let epoch = 0;

/** Stamps a merged value as the next publication, as `Project.publishMerged` does. */
const publishMerged = vi.fn((merged: object) => ({
  ...merged,
  publicationEpoch: ++epoch,
}));

/** Fires a parse result on `project`, as `Project` does after `dbt parse`. */
function publish(
  project: Mocked<Project>,
  emitter: EventEmitter<ParsedManifest>,
) {
  void project;
  emitter.fire(emptyParsedManifest());
}

describe("Projects", () => {
  let projects: Projects;
  let mockDbtTerminal: Mocked<Log>;
  let mockProjectRegistry: any;
  let mockDbtProjectFactory: Mock;
  let mockProject1: Mocked<Project>;
  let mockProject2: Mocked<Project>;
  let declaredProject1: any;
  let declaredProject2: any;
  let registryOnDidChangeProjects: EventEmitter<void>;
  let project1Manifest: EventEmitter<ParsedManifest>;
  let project2Manifest: EventEmitter<ParsedManifest>;
  /** The roots the project factory was asked to build, in order. */
  let constructed: string[];
  /** Project and registry lifecycle steps that ran, in order. */
  let lifecycle: string[];
  /** The projects whose manifests were rebuilt. */
  let rebuilt: string[];
  /** The errors the log received. */
  let logged: unknown[][];

  beforeEach(() => {
    constructed = [];
    lifecycle = [];
    rebuilt = [];
    logged = [];
    // Mock Log
    mockDbtTerminal = {
      debug: vi.fn(),
      error: (...args: unknown[]) => logged.push(args),
      info: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Mocked<Log>;

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

    project1Manifest = new EventEmitter<ParsedManifest>();
    project2Manifest = new EventEmitter<ParsedManifest>();

    // Mock Project instances
    mockProject1 = {
      projectRoot: Uri.file("/project1"),
      getProjectName: vi.fn().mockReturnValue("project1"),
      getAdapterType: vi.fn().mockReturnValue("snowflake"),
      initialize: vi.fn(() => {
        lifecycle.push("init project1");
      }),
      dispose: vi.fn(() => {
        lifecycle.push("dispose project1");
      }),
      manifest: undefined,
      onDidParse: project1Manifest.event,
      onDidCompile: new EventEmitter<void>().event,
      onSourceFileChanged: new EventEmitter<void>().event,
      onDidChangeClient: new EventEmitter<void>().event,
      lsp: {},
      publishMerged: publishMerged,
      rebuildManifest: vi.fn(() => {
        rebuilt.push("project1");
      }),
    } as unknown as Mocked<Project>;

    mockProject2 = {
      projectRoot: Uri.file("/project2"),
      getProjectName: vi.fn().mockReturnValue("project2"),
      getAdapterType: vi.fn().mockReturnValue("snowflake"),
      initialize: vi.fn(() => {
        lifecycle.push("init project2");
      }),
      dispose: vi.fn(() => {
        lifecycle.push("dispose project2");
      }),
      manifest: undefined,
      onDidParse: project2Manifest.event,
      onDidCompile: new EventEmitter<void>().event,
      onSourceFileChanged: new EventEmitter<void>().event,
      onDidChangeClient: new EventEmitter<void>().event,
      lsp: {},
      publishMerged: publishMerged,
      rebuildManifest: vi.fn(() => {
        rebuilt.push("project2");
      }),
    } as unknown as Mocked<Project>;

    // Mock factory
    mockDbtProjectFactory = vi.fn(({ root: uri }: { root: Uri }) => {
      constructed.push(uri.fsPath);
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
      dispose: () => {
        lifecycle.push("dispose registry");
      },
    };

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

      expect(constructed).toEqual(["/project1", "/project2"]);
      expect(lifecycle.sort()).toEqual(["init project1", "init project2"]);

      // Trigger a second sync via registry change
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      // Nothing is constructed or initialized again
      expect(constructed).toEqual(["/project1", "/project2"]);
      expect(lifecycle).toHaveLength(2);
    });

    it("re-parses only the projects whose target or profilesDir changed", async () => {
      await projects.initialize();
      const calls = vi.mocked(workspace.onDidChangeConfiguration).mock.calls;
      const listener = calls[calls.length - 1]?.[0];
      listener?.({
        affectsConfiguration: (key: string, scope?: Uri) =>
          key === "fusionPowerUser.target" && scope?.fsPath === "/project1",
      });

      expect(rebuilt).toEqual(["project1"]);
    });

    it("fires onDidInitialize even when no projects exist", async () => {
      mockProjectRegistry.projects = [];
      const other = new Projects(
        mockProjectRegistry,
        mockDbtProjectFactory as any,
        mockDbtTerminal,
      );

      const initialized: string[] = [];
      other.onDidInitialize(() => initialized.push("initialized"));

      await other.initialize();

      expect(initialized).toEqual(["initialized"]);
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
      lifecycle.length = 0;
      projects.onDidRemoveProject((root) =>
        lifecycle.push(`removed ${root.fsPath}`),
      );

      // Reduce registry to one project
      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(lifecycle).toEqual(["removed /project2", "dispose project2"]);
    });

    it("fires the removed project's root on onDidRemoveProject", async () => {
      const removed: Uri[] = [];
      projects.onDidRemoveProject((root) => removed.push(root));

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(removed).toEqual([mockProject2.projectRoot]);
    });

    it("aggregates onDidChangeManifest across projects and stops after removal", async () => {
      const changed: Project[] = [];
      projects.onDidChangeManifest((project) => changed.push(project));

      publish(mockProject1, project1Manifest);
      publish(mockProject2, project2Manifest);
      expect(changed).toEqual([mockProject1, mockProject2]);

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      publish(mockProject2, project2Manifest);

      expect(changed).toEqual([mockProject1, mockProject2]);
    });
  });

  describe("registry reconciliation", () => {
    it("should follow registry order changes", async () => {
      await projects.initialize();
      mockProjectRegistry.projects = [declaredProject2, declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(projects.all()).toEqual([mockProject2, mockProject1]);
      expect(constructed).toEqual(["/project1", "/project2"]);
    });

    it("serializes removal after project initialization", async () => {
      mockProjectRegistry.projects = [];
      await projects.initialize();
      let finish!: () => void;
      lifecycle.length = 0;
      mockProject1.initialize.mockImplementation(() => {
        lifecycle.push("init project1 started");
        return new Promise<void>((resolve) => {
          finish = () => {
            lifecycle.push("init project1 finished");
            resolve();
          };
        });
      });

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      mockProjectRegistry.projects = [];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(lifecycle).toEqual(["init project1 started"]);
      finish();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      expect(lifecycle).toEqual([
        "init project1 started",
        "init project1 finished",
        "dispose project1",
      ]);
    });

    it("reports reconciliation failures", async () => {
      mockProjectRegistry.projects = [];
      await projects.initialize();
      mockProject1.initialize.mockRejectedValue(new Error("broken project"));

      mockProjectRegistry.projects = [declaredProject1];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(logged).toEqual([
        ["Projects", "Project synchronization failed", expect.any(Error)],
      ]);
    });
  });

  describe("lookup API", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("ignores a second initialize", async () => {
      constructed.length = 0;
      await projects.initialize();
      expect(constructed).toEqual([]);
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
      lifecycle.length = 0;
      projects.dispose();
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));

      expect(lifecycle.sort()).toEqual([
        "dispose project1",
        "dispose project2",
      ]);
      expect(projects.all()).toEqual([]);
      expect(constructed).toEqual(["/project1", "/project2"]);
    });

    it("should fire project removed on disposal", () => {
      const roots: string[] = [];
      projects.onDidRemoveProject((root) => roots.push(root.fsPath));

      projects.dispose();

      expect(roots.sort()).toEqual([
        mockProject1.projectRoot.fsPath,
        mockProject2.projectRoot.fsPath,
      ]);
    });
  });

  describe("metadata source integration", () => {
    beforeEach(async () => {
      await projects.initialize();
    });

    it("routes each publication once and drops events after removal", async () => {
      const changed: Project[] = [];
      const steps: string[] = [];
      const disposeSource = CompositeMetadataSource.prototype.dispose;
      vi.spyOn(CompositeMetadataSource.prototype, "dispose").mockImplementation(
        function (this: CompositeMetadataSource) {
          steps.push("source disposed");
          return disposeSource.call(this);
        },
      );
      projects.onDidChangeManifest((project) => changed.push(project));
      projects.onDidRemoveProject((root) =>
        steps.push(`removed ${root.fsPath}`),
      );

      publish(mockProject1, project1Manifest);

      expect(changed).toEqual([mockProject1]);

      mockProjectRegistry.projects = [declaredProject2];
      registryOnDidChangeProjects.fire();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(steps).toEqual(["removed /project1", "source disposed"]);

      publish(mockProject1, project1Manifest);
      expect(changed).toEqual([mockProject1]);

      steps.length = 0;
      projects.dispose();
      expect(steps.filter((step) => step === "source disposed")).toHaveLength(
        1,
      );
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

      expect(constructed).toEqual(["/project1", "/project2", "/project1"]);
      expect(lifecycle.filter((step) => step === "dispose project1")).toEqual([
        "dispose project1",
      ]);
    });
  });
});
