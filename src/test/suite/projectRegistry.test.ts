import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { WorkspaceFolder } from "vscode";
import { RelativePattern, Uri, workspace } from "vscode";
import type { FusionClientFactory } from "../../fusion/fusionLanguageClient";
import { FusionClientPoolImpl } from "../../projects/fusionClientPool";
import {
  ENABLED_SETTING,
  PROJECTS_SETTING,
} from "../../projects/projectConfiguration";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";
import { waitFor } from "../async";
import { esmDirname } from "../esmDirname";
import { createMockLogOutputChannel } from "../mock/vscode";
import { fakeProjectEnvironments, sampleExecutable } from "../projectHarness";

const fixturesRoot = path.resolve(esmDirname(import.meta.url), "../fixtures");

const makeFolder = (name: string): WorkspaceFolder => ({
  uri: Uri.file(path.join(fixturesRoot, name)),
  name,
  index: 0,
});

const makeConfig = (projects: string[] = []) =>
  ({
    get: vi.fn((key) => (key === PROJECTS_SETTING ? projects : undefined)),
    has: vi.fn(),
    update: vi.fn(),
    inspect: vi.fn(),
  }) as any;

describe("ProjectRegistry", () => {
  let terminal: any;

  beforeEach((): void => {
    vi.clearAllMocks();
    terminal = {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    } as any;
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it("registers declared projects in order with correct names", async () => {
    const general = makeFolder("multi-root");
    vi.spyOn(workspace, "getConfiguration").mockImplementation(
      (_section, scope) =>
        scope === general.uri
          ? makeConfig(["projects/general", "projects/sox"])
          : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [general];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(2);
    expect(registry.projects[0].root.fsPath).toContain("projects/general");
    expect(registry.projects[1].root.fsPath).toContain("projects/sox");
    expect(registry.projects[0].name).toBe("general");
    expect(registry.projects[1].name).toBe("sox");
  });

  it("registers no projects for a folder with enabled false", async () => {
    const enabled = makeFolder("multi-root");
    const disabled = { ...makeFolder("single-project"), index: 1 };
    vi.spyOn(workspace, "getConfiguration").mockImplementation(
      (_section, scope) =>
        ({
          get: (key: string) =>
            key === ENABLED_SETTING
              ? scope !== disabled.uri
              : key === PROJECTS_SETTING
                ? [scope === disabled.uri ? "." : "projects/general"]
                : undefined,
        }) as any,
    );
    (workspace.workspaceFolders as any) = [enabled, disabled];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects.map((p) => p.root.fsPath)).toEqual([
      path.join(enabled.uri.fsPath, "projects/general"),
    ]);
  });

  it("adds and removes projects when enabled toggles", async () => {
    const folder = makeFolder("multi-root");
    let enabled = false;
    let onConfiguration:
      | ((event: { affectsConfiguration(section: string): boolean }) => void)
      | undefined;
    vi.spyOn(workspace, "getConfiguration").mockImplementation(
      () =>
        ({
          get: (key: string) =>
            key === ENABLED_SETTING
              ? enabled
              : key === PROJECTS_SETTING
                ? ["projects/general"]
                : undefined,
        }) as any,
    );
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
      (listener) => {
        onConfiguration = listener as typeof onConfiguration;
        return { dispose: vi.fn() };
      },
    );
    (workspace.workspaceFolders as any) = [folder];
    const registry = new ProjectRegistry(terminal);
    await registry.initialize();
    expect(registry.projects).toHaveLength(0);

    const affectsEnabled = {
      affectsConfiguration: (section: string) =>
        section === "fusionPowerUser.enabled",
    };
    enabled = true;
    onConfiguration?.(affectsEnabled);
    expect(registry.projects).toHaveLength(1);

    enabled = false;
    onConfiguration?.(affectsEnabled);
    expect(registry.projects).toHaveLength(0);
  });

  it("registers the same projects from a parent folder or individual folders", async () => {
    const parent = makeFolder("multi-root");
    const general: WorkspaceFolder = {
      uri: Uri.file(path.join(parent.uri.fsPath, "projects/general")),
      name: "general",
      index: 0,
    };
    const sox: WorkspaceFolder = {
      uri: Uri.file(path.join(parent.uri.fsPath, "projects/sox")),
      name: "sox",
      index: 1,
    };
    const getConfiguration = vi.spyOn(workspace, "getConfiguration");
    getConfiguration.mockImplementation((_section, scope) =>
      scope === parent.uri
        ? makeConfig(["projects/general", "projects/sox"])
        : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [parent];

    const parentRegistry = new ProjectRegistry(terminal);
    await parentRegistry.initialize();
    const fromParent = parentRegistry.projects.map(({ root, name }) => ({
      root: root.fsPath,
      name,
    }));
    parentRegistry.dispose();

    (workspace.workspaceFolders as any) = [general, sox];
    const individualRegistry = new ProjectRegistry(terminal);
    await individualRegistry.initialize();
    const fromIndividualFolders = individualRegistry.projects.map(
      ({ root, name }) => ({ root: root.fsPath, name }),
    );

    expect(fromIndividualFolders).toEqual(fromParent);
    individualRegistry.dispose();
  });

  it("attributes copied-tree files to their declared parent", async () => {
    const general = makeFolder("multi-root");
    vi.spyOn(workspace, "getConfiguration").mockImplementation(
      (_section, scope) =>
        scope === general.uri
          ? makeConfig(["projects/general", "projects/sox"])
          : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [general];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    const copiedFile = Uri.file(
      path.join(
        general.uri.fsPath,
        "projects/general/.state_copy/models/copied.sql",
      ),
    );
    expect(registry.findProject(copiedFile)?.root.fsPath).toBe(
      path.join(general.uri.fsPath, "projects/general"),
    );
  });

  it("falls back to folder root when no explicit declaration", async () => {
    const single = makeFolder("single-project");
    vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    (workspace.workspaceFolders as any) = [single];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0].name).toBe("single_project");
  });

  it("registers nothing when folder has no dbt_project.yml", async () => {
    const nested = makeFolder("nested-project");
    vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    const findFiles = vi.spyOn(workspace, "findFiles");
    const createWatcher = vi.spyOn(workspace, "createFileSystemWatcher");
    (workspace.workspaceFolders as any) = [nested];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(0);
    expect(findFiles).not.toHaveBeenCalled();
    expect(createWatcher).not.toHaveBeenCalled();
  });

  it("applies fail-closed semantics: invalid entry blocks folder, sibling succeeds", async () => {
    const general = makeFolder("multi-root");
    const single = makeFolder("single-project");
    vi.spyOn(workspace, "getConfiguration").mockImplementation(
      (_section, scope) =>
        scope === general.uri
          ? makeConfig(["projects/general", "projects/typo"])
          : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [general, single];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0].folder.name).toBe("single-project");
    expect(terminal.warn).toHaveBeenCalled();
  });

  it("accepts explicitly declared roots under packages paths as Declared Projects", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
    const root = path.join(tmpDir, "shop");
    const vendor = path.join(root, "vendor");
    const dep = path.join(vendor, "dep");
    try {
      mkdirSync(dep, { recursive: true });
      writeFileSync(
        path.join(root, "dbt_project.yml"),
        "version: '1.0'\nprofile: default\nmodel-paths: [models]\npackages-install-path: vendor\n",
      );
      writeFileSync(
        path.join(dep, "dbt_project.yml"),
        "version: '1.0'\nprofile: default\nmodel-paths: [models]\n",
      );

      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      vi.spyOn(workspace, "getConfiguration").mockImplementation((_s, scope) =>
        scope === folder.uri
          ? makeConfig([
              path.relative(tmpDir, root),
              path.relative(tmpDir, dep),
            ])
          : makeConfig([]),
      );
      (workspace.workspaceFolders as any) = [folder];

      const registry = new ProjectRegistry(terminal);
      await registry.initialize();

      expect(registry.projects).toHaveLength(2);
      expect(registry.projects.some((p) => p.root.fsPath === root)).toBe(true);
      expect(registry.projects.some((p) => p.root.fsPath === dep)).toBe(true);
      expect(registry.projects.map((project) => project.name)).toEqual([
        "shop",
        "dep",
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("deduplicates same root across folders: first folder wins", async () => {
    const general = makeFolder("multi-root");
    const single = makeFolder("single-project");
    vi.spyOn(workspace, "getConfiguration").mockImplementation((_s, scope) => {
      if (scope === general.uri) {
        return makeConfig([
          path.relative(
            general.uri.fsPath,
            path.join(fixturesRoot, "multi-root", "projects/general"),
          ),
        ]);
      }
      if (scope === single.uri) {
        return makeConfig([
          path.relative(
            single.uri.fsPath,
            path.join(fixturesRoot, "multi-root", "projects/general"),
          ),
        ]);
      }
      return makeConfig([]);
    });
    (workspace.workspaceFolders as any) = [general, single];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0].folder).toBe(general);
  });

  it("deduplicates canonical roots while preserving the first lexical root", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
    const projectRoot = path.join(tmpDir, "project");
    const alias = path.join(tmpDir, "alias");
    try {
      mkdirSync(projectRoot);
      writeFileSync(
        path.join(projectRoot, "dbt_project.yml"),
        "name: canonical\nversion: '1.0'\n",
      );
      symlinkSync(projectRoot, alias);
      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      vi.spyOn(workspace, "getConfiguration").mockReturnValue(
        makeConfig(["project", "alias"]),
      );
      (workspace.workspaceFolders as any) = [folder];

      const registry = new ProjectRegistry(terminal);
      await registry.initialize();

      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0].root.fsPath).toBe(projectRoot);
      expect(
        registry.findProject(Uri.file(path.join(alias, "models/model.sql"))),
      ).toBe(registry.projects[0]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("skips and reports an unparseable declared project", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
    try {
      writeFileSync(path.join(tmpDir, "dbt_project.yml"), "name: [");
      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
      (workspace.workspaceFolders as any) = [folder];

      const registry = new ProjectRegistry(terminal);
      await registry.initialize();

      expect(registry.projects).toEqual([]);
      expect(terminal.warn).toHaveBeenCalledWith(
        "projectRegistry",
        expect.stringContaining(tmpDir),
      );
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it.each(["", "# comment only\n"])(
    "uses the basename when project YAML has no mapping",
    async (content) => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
      try {
        writeFileSync(path.join(tmpDir, "dbt_project.yml"), content);
        const folder: WorkspaceFolder = {
          uri: Uri.file(tmpDir),
          name: "test",
          index: 0,
        };
        vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
        (workspace.workspaceFolders as any) = [folder];

        const registry = new ProjectRegistry(terminal);
        await registry.initialize();

        expect(registry.projects[0].name).toBe(path.basename(tmpDir));
        expect(terminal.warn).not.toHaveBeenCalled();
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    },
  );

  it("findProject uses deepest-root-first lookup", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
    const a = path.join(tmpDir, "a");
    const aNested = path.join(a, "nested");
    try {
      mkdirSync(aNested, { recursive: true });
      writeFileSync(
        path.join(a, "dbt_project.yml"),
        "version: '1.0'\nprofile: default\nmodel-paths: [models]\n",
      );
      writeFileSync(
        path.join(aNested, "dbt_project.yml"),
        "version: '1.0'\nprofile: default\nmodel-paths: [models]\n",
      );

      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      vi.spyOn(workspace, "getConfiguration").mockImplementation((_s, scope) =>
        scope === folder.uri
          ? makeConfig([
              path.relative(tmpDir, a),
              path.relative(tmpDir, aNested),
            ])
          : makeConfig([]),
      );
      (workspace.workspaceFolders as any) = [folder];

      const registry = new ProjectRegistry(terminal);
      await registry.initialize();

      const nestedFile = Uri.file(path.join(aNested, "models/model.sql"));
      expect(registry.findProject(nestedFile)?.root.fsPath).toBe(aNested);

      const aFile = Uri.file(path.join(a, "models/model.sql"));
      expect(registry.findProject(aFile)?.root.fsPath).toBe(a);

      const outsideFile = Uri.file(path.join(tmpDir, "other.sql"));
      expect(registry.findProject(outsideFile)).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("contains matches exact or separator-prefix", async () => {
    const single = makeFolder("single-project");
    vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    (workspace.workspaceFolders as any) = [single];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects[0].contains(Uri.file(single.uri.fsPath))).toBe(
      true,
    );
    expect(
      registry.projects[0].contains(
        Uri.file(path.join(single.uri.fsPath, "models/model.sql")),
      ),
    ).toBe(true);
    expect(registry.projects[0].contains({ fsPath: undefined } as any)).toBe(
      false,
    );
  });

  it("preserves registration order across folder and declaration order", async () => {
    const general = makeFolder("multi-root");
    vi.spyOn(workspace, "getConfiguration").mockImplementation((_s, scope) =>
      scope === general.uri
        ? makeConfig(["projects/sox", "projects/general"])
        : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [general];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects[0].root.fsPath).toContain("projects/sox");
    expect(registry.projects[1].root.fsPath).toContain("projects/general");
  });

  it("creates watchers for each registered project", async () => {
    const general = makeFolder("multi-root");
    vi.spyOn(workspace, "getConfiguration").mockImplementation((_s, scope) =>
      scope === general.uri
        ? makeConfig(["projects/general", "projects/sox"])
        : makeConfig([]),
    );
    (workspace.workspaceFolders as any) = [general];

    let watcherCount = 0;
    vi.spyOn(workspace, "createFileSystemWatcher").mockImplementation(() => {
      watcherCount++;
      return {
        onDidCreate: vi.fn(),
        onDidChange: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      } as any;
    });

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(watcherCount).toBe(2);
    expect(
      (RelativePattern as unknown as Mock).mock.calls.map(([root, pattern]) => [
        (root as Uri).fsPath,
        pattern,
      ]),
    ).toEqual([
      [
        path.join(general.uri.fsPath, "projects/general"),
        "dbt_project.{yml,yaml}",
      ],
      [path.join(general.uri.fsPath, "projects/sox"), "dbt_project.{yml,yaml}"],
    ]);
  });

  it("reconciles relevant configuration changes without replacing survivors", async () => {
    const general = makeFolder("multi-root");
    let projects: string[] = [];
    let onConfiguration:
      | ((event: { affectsConfiguration(section: string): boolean }) => void)
      | undefined;
    vi.spyOn(workspace, "getConfiguration").mockImplementation(() =>
      makeConfig(projects),
    );
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
      (listener) => {
        onConfiguration = listener as typeof onConfiguration;
        return { dispose: vi.fn() };
      },
    );
    (workspace.workspaceFolders as any) = [general];
    const changed = vi.fn();
    const registry = new ProjectRegistry(terminal);
    registry.onDidChangeProjects(changed);
    await registry.initialize();

    projects = ["projects/general"];
    onConfiguration?.({
      affectsConfiguration: (section) => section === "fusionPowerUser.projects",
    });
    const project = registry.projects[0];
    onConfiguration?.({ affectsConfiguration: () => false });
    onConfiguration?.({ affectsConfiguration: () => true });

    expect(registry.projects[0]).toBe(project);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("reconciles workspace folder changes", async () => {
    const single = makeFolder("single-project");
    let onFolders: (() => void) | undefined;
    vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    vi.spyOn(workspace, "onDidChangeWorkspaceFolders").mockImplementation(
      (listener) => {
        onFolders = listener as () => void;
        return { dispose: vi.fn() };
      },
    );
    (workspace.workspaceFolders as any) = [];
    const changed = vi.fn();
    const registry = new ProjectRegistry(terminal);
    registry.onDidChangeProjects(changed);
    await registry.initialize();

    (workspace.workspaceFolders as any) = [single];
    onFolders?.();
    (workspace.workspaceFolders as any) = [];
    onFolders?.();

    expect(registry.projects).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("reconciles from a project-file watcher", async () => {
    const general = makeFolder("multi-root");
    let projects = ["projects/general"];
    let onDelete: (() => void) | undefined;
    vi.spyOn(workspace, "getConfiguration").mockImplementation(() =>
      makeConfig(projects),
    );
    vi.spyOn(workspace, "createFileSystemWatcher").mockReturnValue({
      onDidCreate: vi.fn(),
      onDidChange: vi.fn(),
      onDidDelete: vi.fn((listener) => {
        onDelete = listener as () => void;
      }),
      dispose: vi.fn(),
    } as any);
    (workspace.workspaceFolders as any) = [general];
    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    projects = ["projects/typo"];
    onDelete?.();

    expect(registry.projects).toEqual([]);
  });

  it("initializes once and disposes watchers and listeners", async () => {
    const single = makeFolder("single-project");
    const watcherDispose = vi.fn();
    const configurationDispose = vi.fn();
    const foldersDispose = vi.fn();
    vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    vi.spyOn(workspace, "createFileSystemWatcher").mockReturnValue({
      onDidCreate: vi.fn(),
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: watcherDispose,
    } as any);
    vi.spyOn(workspace, "onDidChangeConfiguration").mockReturnValue({
      dispose: configurationDispose,
    });
    vi.spyOn(workspace, "onDidChangeWorkspaceFolders").mockReturnValue({
      dispose: foldersDispose,
    });
    (workspace.workspaceFolders as any) = [single];
    const registry = new ProjectRegistry(terminal);

    await registry.initialize();
    await registry.initialize();
    registry.dispose();

    expect(workspace.createFileSystemWatcher).toHaveBeenCalledTimes(1);
    expect(workspace.onDidChangeConfiguration).toHaveBeenCalledTimes(1);
    expect(workspace.onDidChangeWorkspaceFolders).toHaveBeenCalledTimes(1);
    expect(watcherDispose).toHaveBeenCalledTimes(1);
    expect(configurationDispose).toHaveBeenCalledTimes(1);
    expect(foldersDispose).toHaveBeenCalledTimes(1);
    expect(registry.projects).toEqual([]);
  });

  it("reuses the watcher when project metadata changes", async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
    const projectFile = path.join(tmpDir, "dbt_project.yml");
    let onChange: (() => void) | undefined;
    const watcherDispose = vi.fn();
    try {
      writeFileSync(projectFile, "name: first\nversion: '1.0'\n");
      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      vi.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
      const createWatcher = vi
        .spyOn(workspace, "createFileSystemWatcher")
        .mockReturnValue({
          onDidCreate: vi.fn(),
          onDidChange: vi.fn((listener) => {
            onChange = listener as () => void;
          }),
          onDidDelete: vi.fn(),
          dispose: watcherDispose,
        } as any);
      (workspace.workspaceFolders as any) = [folder];
      const registry = new ProjectRegistry(terminal);
      await registry.initialize();

      writeFileSync(projectFile, "name: second\nversion: '1.0'\n");
      onChange?.();
      expect(registry.projects[0].name).toBe("second");
      expect(createWatcher).toHaveBeenCalledTimes(1);
      expect(watcherDispose).not.toHaveBeenCalled();

      registry.dispose();
      onChange?.();
      expect(watcherDispose).toHaveBeenCalledTimes(1);
      expect(createWatcher).toHaveBeenCalledTimes(1);
      expect(registry.projects).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("reports configuration problems to terminal", async () => {
    const general = makeFolder("multi-root");
    vi.spyOn(workspace, "getConfiguration").mockImplementation(() =>
      makeConfig(["", "projects/typo"]),
    );
    (workspace.workspaceFolders as any) = [general];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(terminal.warn).toHaveBeenCalledWith(
      "projectRegistry",
      expect.stringContaining("Invalid Declared Project entry"),
    );
    expect(terminal.warn).toHaveBeenCalledWith(
      "projectRegistry",
      expect.stringContaining(
        "Declared Project entry projects/typo has no dbt_project.yml",
      ),
    );
  });

  describe("declareFromDocuments", () => {
    const general = makeFolder("multi-root");
    let enabled: boolean;
    let projects: string[];
    let onConfiguration:
      | ((event: { affectsConfiguration(section: string): boolean }) => void)
      | undefined;
    let onFolders: (() => void) | undefined;

    const openedDocument = (
      relative: string,
      overrides: Record<string, unknown> = {},
    ) =>
      ({
        uri: Uri.file(path.join(general.uri.fsPath, relative)),
        languageId: "sql",
        ...overrides,
      }) as any;
    const soxModel = "projects/sox/models/sox_model.sql";
    const roots = (registry: ProjectRegistry) =>
      registry.projects.map((project) => `${project.name}:${project.origin}`);

    async function start(): Promise<ProjectRegistry> {
      const registry = new ProjectRegistry(terminal);
      await registry.initialize();
      return registry;
    }

    beforeEach(() => {
      enabled = true;
      projects = ["projects/general"];
      (workspace as any).isTrusted = true;
      vi.spyOn(workspace, "getConfiguration").mockImplementation(
        () =>
          ({
            get: (key: string) =>
              key === ENABLED_SETTING
                ? enabled
                : key === PROJECTS_SETTING
                  ? projects
                  : undefined,
          }) as any,
      );
      vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
        (listener) => {
          onConfiguration = listener as typeof onConfiguration;
          return { dispose: vi.fn() };
        },
      );
      vi.spyOn(workspace, "onDidChangeWorkspaceFolders").mockImplementation(
        (listener) => {
          onFolders = listener as () => void;
          return { dispose: vi.fn() };
        },
      );
      (workspace.workspaceFolders as any) = [general];
    });

    afterEach(() => {
      (workspace as any).isTrusted = true;
    });

    it("declares the nearest root of an opened file with origin openedFile", async () => {
      const registry = await start();
      const changed = vi.fn();
      registry.onDidChangeProjects(changed);

      registry.declareFromDocuments([openedDocument(soxModel)]);

      expect(roots(registry)).toEqual(["general:explicit", "sox:openedFile"]);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it.each(["jinja-sql", "yaml"])(
      "accepts a %s document",
      async (language) => {
        const registry = await start();
        registry.declareFromDocuments([
          openedDocument(soxModel, { languageId: language }),
        ]);
        expect(roots(registry)).toContain("sox:openedFile");
      },
    );

    it.each([
      [
        "a non-file scheme",
        {
          uri: {
            scheme: "untitled",
            fsPath: path.join(general.uri.fsPath, soxModel),
          },
        },
      ],
      ["an unsupported language", { languageId: "markdown" }],
    ])("ignores a document with %s", async (_name, overrides) => {
      const registry = await start();
      registry.declareFromDocuments([openedDocument(soxModel, overrides)]);
      expect(roots(registry)).toEqual(["general:explicit"]);
    });

    it("ignores documents in an untrusted workspace", async () => {
      (workspace as any).isTrusted = false;
      const registry = await start();
      registry.declareFromDocuments([openedDocument(soxModel)]);
      expect(roots(registry)).toEqual(["general:explicit"]);
    });

    it("ignores documents in a folder with enabled false", async () => {
      enabled = false;
      const registry = await start();
      registry.declareFromDocuments([openedDocument(soxModel)]);
      expect(registry.projects).toHaveLength(0);
    });

    it("does nothing before initialize or after dispose", async () => {
      const registry = new ProjectRegistry(terminal);
      const document = openedDocument(soxModel);
      registry.declareFromDocuments([document]);
      await registry.initialize();
      expect(roots(registry)).toEqual(["general:explicit"]);

      registry.dispose();
      registry.declareFromDocuments([document]);
      expect(registry.projects).toHaveLength(0);
    });

    it("changes nothing when the nearest root is already declared", async () => {
      const registry = await start();
      const changed = vi.fn();
      registry.onDidChangeProjects(changed);

      registry.declareFromDocuments([
        openedDocument("projects/general/models/general_model.sql"),
      ]);

      expect(roots(registry)).toEqual(["general:explicit"]);
      expect(changed).not.toHaveBeenCalled();
    });

    it("adds a nested root even when a declared project is its ancestor", async () => {
      const tmpDir = mkdtempSync(path.join(tmpdir(), "fpu-project-registry-"));
      const nested = path.join(tmpDir, "projects", "sox");
      try {
        writeFileSync(path.join(tmpDir, "dbt_project.yml"), "name: shop\n");
        mkdirSync(nested, { recursive: true });
        writeFileSync(path.join(nested, "dbt_project.yml"), "name: sox\n");
        projects = ["."];
        (workspace.workspaceFolders as any) = [
          { uri: Uri.file(tmpDir), name: "shop", index: 0 },
        ];
        const registry = await start();

        registry.declareFromDocuments([
          {
            uri: Uri.file(path.join(nested, "models", "sox_model.sql")),
            languageId: "sql",
          } as any,
        ]);

        expect(roots(registry)).toEqual(["shop:explicit", "sox:openedFile"]);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("drops opened-file roots when their folder is removed", async () => {
      const registry = await start();
      registry.declareFromDocuments([openedDocument(soxModel)]);
      expect(roots(registry)).toHaveLength(2);

      (workspace.workspaceFolders as any) = [];
      onFolders?.();
      expect(registry.projects).toHaveLength(0);

      (workspace.workspaceFolders as any) = [general];
      onFolders?.();
      expect(roots(registry)).toEqual(["general:explicit"]);
    });

    it("drops opened-file roots when their folder is disabled, and re-enabling does not restore them", async () => {
      const registry = await start();
      registry.declareFromDocuments([openedDocument(soxModel)]);
      const affectsEnabled = {
        affectsConfiguration: (section: string) =>
          section === "fusionPowerUser.enabled",
      };

      enabled = false;
      onConfiguration?.(affectsEnabled);
      expect(registry.projects).toHaveLength(0);

      enabled = true;
      onConfiguration?.(affectsEnabled);
      expect(roots(registry)).toEqual(["general:explicit"]);
    });

    it("gives an opened-file project its environment before the pool resolves it", async () => {
      const registry = await start();
      const environments = fakeProjectEnvironments({ TOOL: "mise" });
      const resolve = vi.fn(async (_root: Uri, _environment: unknown) =>
        sampleExecutable(),
      );
      const create = vi.fn((_options: unknown) => ({
        stop: vi.fn(() => Promise.resolve()),
        dispose: vi.fn(),
      }));
      const pool = new FusionClientPoolImpl(
        registry,
        terminal,
        { resolve },
        { create } as unknown as FusionClientFactory,
        {
          readSnapshot: readProjectSnapshot,
          environments,
          outputChannel: () => createMockLogOutputChannel(),
        },
      );
      pool.initialize();
      registry.declareFromDocuments([openedDocument(soxModel)]);

      try {
        const soxRoot = path.join(general.uri.fsPath, "projects/sox");
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        const ensureIndex = environments.ensure.mock.calls.findIndex(
          ([project]) => project.root.fsPath === soxRoot,
        );
        const resolveIndex = resolve.mock.calls.findIndex(
          ([root]) => root.fsPath === soxRoot,
        );
        expect(ensureIndex).toBeGreaterThanOrEqual(0);
        expect(resolveIndex).toBeGreaterThanOrEqual(0);
        expect(
          environments.ensure.mock.invocationCallOrder[ensureIndex],
        ).toBeLessThan(resolve.mock.invocationCallOrder[resolveIndex]);
        expect(resolve.mock.calls[resolveIndex][1]).toBe(
          await environments.ensure.mock.results[ensureIndex].value,
        );
      } finally {
        await pool.stop();
      }
    });
  });
});
