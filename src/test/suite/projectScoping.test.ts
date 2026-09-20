import { afterEach, describe, expect, it, jest } from "@jest/globals";
import * as path from "path";
import { EventEmitter, Uri, workspace } from "vscode";
import { ProjectRegisteredUnregisteredEvent } from "../../dbt_client/dbtProjectContainer";
import { DBTWorkspaceFolder } from "../../dbt_client/dbtWorkspaceFolder";
import { ManifestCacheChangedEvent } from "../../dbt_client/event/manifestCacheChangedEvent";

/**
 * Consumer cases 3–6. `it.failing` bodies assert the Phase 4 contract so they
 * fail on today's discovery and flip to passing when Phase 4 lands.
 */

const fixturesRoot = path.resolve(__dirname, "../fixtures");

function yml(projectRoot: string) {
  return Uri.file(path.join(projectRoot, "dbt_project.yml"));
}

function mockProject(projectPath: string, name: string) {
  return {
    contains: (uri: { fsPath: string }) =>
      uri.fsPath === projectPath ||
      uri.fsPath.startsWith(projectPath + path.sep),
    projectRoot: Uri.file(projectPath),
    getProjectName: () => name,
    getPackageInstallPath: () => undefined,
    initialize: async () => undefined,
    dispose: () => undefined,
    onRebuildManifestStatusChange: () => ({ dispose: () => undefined }),
  };
}

function mockConfig(allowList: string[] = []) {
  return {
    get: (key: string, fallback: unknown) =>
      key === "allowListFolders" ? allowList : fallback,
    has: jest.fn(),
    update: jest.fn(),
  };
}

function createFolder(
  workspacePath: string,
  findYmls: ReturnType<typeof Uri.file>[],
) {
  const workspaceFolder = {
    uri: Uri.file(workspacePath),
    name: path.basename(workspacePath),
    index: 0,
  };
  const detected: string[] = [];
  const detection = {
    discoverProjects: jest.fn((projectPaths: string[]) => {
      detected.push(...projectPaths);
      return Promise.resolve(projectPaths);
    }),
  };
  const factory = jest.fn((uri: { fsPath: string }) =>
    mockProject(uri.fsPath, path.basename(uri.fsPath)),
  );
  workspace.findFiles = jest.fn(() => Promise.resolve(findYmls));
  const instance = new DBTWorkspaceFolder(
    factory as never,
    (() => detection) as never,
    { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as never,
    workspaceFolder as never,
    new EventEmitter<ManifestCacheChangedEvent>(),
    new EventEmitter<ProjectRegisteredUnregisteredEvent>(),
  );
  return { instance, workspaceFolder, detected, factory };
}

describe("Project scoping (consumer cases 3–6)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("case 3: folder-scoped allowListFolders wins", () => {
    it.failing("reads allowListFolders with the folder URI", () => {
      const workspacePath = path.join(fixturesRoot, "multi-root");
      const { instance, workspaceFolder } = createFolder(workspacePath, []);
      jest
        .spyOn(workspace, "getConfiguration")
        .mockImplementation((...args: unknown[]) => {
          const scope = args[1] as { fsPath?: string } | undefined;
          const folderScoped =
            scope !== undefined &&
            (scope === workspaceFolder.uri ||
              scope.fsPath === workspaceFolder.uri.fsPath);
          const allowList = folderScoped
            ? ["projects/general"]
            : ["projects/sox"];
          return mockConfig(allowList) as never;
        });

      const allowList = instance.getAllowListFolders();
      expect(workspace.getConfiguration).toHaveBeenCalledWith(
        "dbt",
        workspaceFolder.uri,
      );
      expect(allowList).toEqual([path.join(workspacePath, "projects/general")]);
      instance.dispose();
    });
  });

  describe("case 4: file outside a project has no Project Context", () => {
    it("resolves an inside URI and not pipelines/", async () => {
      const workspacePath = path.join(fixturesRoot, "multi-root");
      const general = path.join(workspacePath, "projects/general");
      jest
        .spyOn(workspace, "getConfiguration")
        .mockReturnValue(mockConfig([]) as never);
      const { instance } = createFolder(workspacePath, [yml(general)]);
      await instance.discoverProjects();

      expect(
        instance
          .findDBTProject(Uri.file(path.join(general, "models", "orders.sql")))
          ?.getProjectName(),
      ).toBe("general");
      expect(
        instance.findDBTProject(
          Uri.file(path.join(workspacePath, "pipelines", "task.py")),
        ),
      ).toBeUndefined();
      instance.dispose();
    });
  });

  describe("case 5: copied project tree must not register", () => {
    it.failing("does not register .state_copy", async () => {
      const workspacePath = path.join(fixturesRoot, "multi-root");
      const general = path.join(workspacePath, "projects/general");
      const copy = path.join(general, ".state_copy");
      const sox = path.join(workspacePath, "projects/sox");
      jest
        .spyOn(workspace, "getConfiguration")
        .mockReturnValue(mockConfig([]) as never);
      const { instance } = createFolder(workspacePath, [
        yml(general),
        yml(copy),
        yml(sox),
      ]);
      await instance.discoverProjects();

      const roots = instance
        .getProjects()
        .map((project) => project.projectRoot.fsPath)
        .sort();
      expect(roots).toEqual([general, sox].sort());
      instance.dispose();
    });
  });

  describe("case 6: folder without root dbt_project.yml", () => {
    it.failing(
      "registers nothing and creates no recursive watcher",
      async () => {
        const workspacePath = path.join(fixturesRoot, "nested-project");
        const nested = path.join(workspacePath, "projects/analytics");
        const watcher = jest.spyOn(workspace, "createFileSystemWatcher");
        jest
          .spyOn(workspace, "getConfiguration")
          .mockReturnValue(mockConfig([]) as never);
        const { instance } = createFolder(workspacePath, [yml(nested)]);
        await instance.discoverProjects();

        expect(watcher).not.toHaveBeenCalled();
        expect(instance.getProjects()).toHaveLength(0);
        instance.dispose();
      },
    );
  });
});
