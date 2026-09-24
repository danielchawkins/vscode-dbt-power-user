import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { RelativePattern, Uri, workspace, WorkspaceFolder } from "vscode";
import { DBT_PROJECT_FILE } from "../../dbt_integration";
import { PROJECTS_SETTING } from "../../projects/projectConfiguration";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { esmDirname } from "../esmDirname";

const fixturesRoot = path.resolve(esmDirname(import.meta.url), "../fixtures");

const makeFolder = (name: string): WorkspaceFolder => ({
  uri: Uri.file(path.join(fixturesRoot, name)),
  name,
  index: 0,
});

const makeConfig = (projects: string[] = []) =>
  ({
    get: jest.fn((key) => (key === PROJECTS_SETTING ? projects : undefined)),
    has: jest.fn(),
    update: jest.fn(),
    inspect: jest.fn(),
  }) as any;

describe("ProjectRegistry", () => {
  let terminal: any;

  beforeEach((): void => {
    jest.clearAllMocks();
    terminal = {
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    } as any;
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  it("registers declared projects in order with correct names", async () => {
    const general = makeFolder("multi-root");
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_section, scope) =>
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
    const getConfiguration = jest.spyOn(workspace, "getConfiguration");
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_section, scope) =>
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
    jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    (workspace.workspaceFolders as any) = [single];

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0].name).toBe("single_project");
  });

  it("registers nothing when folder has no dbt_project.yml", async () => {
    const nested = makeFolder("nested-project");
    jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    const findFiles = jest.spyOn(workspace, "findFiles");
    const createWatcher = jest.spyOn(workspace, "createFileSystemWatcher");
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_section, scope) =>
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
      jest
        .spyOn(workspace, "getConfiguration")
        .mockImplementation((_s, scope) =>
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_s, scope) => {
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
      jest
        .spyOn(workspace, "getConfiguration")
        .mockReturnValue(makeConfig(["project", "alias"]));
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
      jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
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
        jest
          .spyOn(workspace, "getConfiguration")
          .mockReturnValue(makeConfig([]));
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
      jest
        .spyOn(workspace, "getConfiguration")
        .mockImplementation((_s, scope) =>
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
    jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_s, scope) =>
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_s, scope) =>
        scope === general.uri
          ? makeConfig(["projects/general", "projects/sox"])
          : makeConfig([]),
      );
    (workspace.workspaceFolders as any) = [general];

    let watcherCount = 0;
    jest.spyOn(workspace, "createFileSystemWatcher").mockImplementation(() => {
      watcherCount++;
      return {
        onDidCreate: jest.fn(),
        onDidChange: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
      } as any;
    });

    const registry = new ProjectRegistry(terminal);
    await registry.initialize();

    expect(watcherCount).toBe(2);
    expect(
      (RelativePattern as unknown as jest.Mock).mock.calls.map(
        ([root, pattern]) => [(root as Uri).fsPath, pattern],
      ),
    ).toEqual([
      [path.join(general.uri.fsPath, "projects/general"), DBT_PROJECT_FILE],
      [path.join(general.uri.fsPath, "projects/sox"), DBT_PROJECT_FILE],
    ]);
  });

  it("reconciles relevant configuration changes without replacing survivors", async () => {
    const general = makeFolder("multi-root");
    let projects: string[] = [];
    let onConfiguration:
      | ((event: { affectsConfiguration(section: string): boolean }) => void)
      | undefined;
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation(() => makeConfig(projects));
    jest
      .spyOn(workspace, "onDidChangeConfiguration")
      .mockImplementation((listener) => {
        onConfiguration = listener as typeof onConfiguration;
        return { dispose: jest.fn() };
      });
    (workspace.workspaceFolders as any) = [general];
    const changed = jest.fn();
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
    jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    jest
      .spyOn(workspace, "onDidChangeWorkspaceFolders")
      .mockImplementation((listener) => {
        onFolders = listener as () => void;
        return { dispose: jest.fn() };
      });
    (workspace.workspaceFolders as any) = [];
    const changed = jest.fn();
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation(() => makeConfig(projects));
    jest.spyOn(workspace, "createFileSystemWatcher").mockReturnValue({
      onDidCreate: jest.fn(),
      onDidChange: jest.fn(),
      onDidDelete: jest.fn((listener) => {
        onDelete = listener as () => void;
      }),
      dispose: jest.fn(),
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
    const watcherDispose = jest.fn();
    const configurationDispose = jest.fn();
    const foldersDispose = jest.fn();
    jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
    jest.spyOn(workspace, "createFileSystemWatcher").mockReturnValue({
      onDidCreate: jest.fn(),
      onDidChange: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: watcherDispose,
    } as any);
    jest
      .spyOn(workspace, "onDidChangeConfiguration")
      .mockReturnValue({ dispose: configurationDispose } as any);
    jest
      .spyOn(workspace, "onDidChangeWorkspaceFolders")
      .mockReturnValue({ dispose: foldersDispose } as any);
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
    const watcherDispose = jest.fn();
    try {
      writeFileSync(projectFile, "name: first\nversion: '1.0'\n");
      const folder: WorkspaceFolder = {
        uri: Uri.file(tmpDir),
        name: "test",
        index: 0,
      };
      jest.spyOn(workspace, "getConfiguration").mockReturnValue(makeConfig([]));
      const createWatcher = jest
        .spyOn(workspace, "createFileSystemWatcher")
        .mockReturnValue({
          onDidCreate: jest.fn(),
          onDidChange: jest.fn((listener) => {
            onChange = listener as () => void;
          }),
          onDidDelete: jest.fn(),
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
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation(() => makeConfig(["", "projects/typo"]));
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
});
