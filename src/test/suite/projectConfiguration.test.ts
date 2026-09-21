import { afterEach, describe, expect, it, jest } from "@jest/globals";
import * as path from "path";
import {
  Uri,
  workspace,
  WorkspaceConfiguration,
  WorkspaceFolder,
} from "vscode";
import {
  CONFIGURATION_SECTION,
  PROJECTS_SETTING,
  resolveDeclaredProjectRoots,
} from "../../projects/projectConfiguration";
import { esmDirname } from "../esmDirname";

const fixturesRoot = path.resolve(esmDirname(import.meta.url), "../fixtures");

describe("resolveDeclaredProjectRoots", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads folder-scoped declarations", () => {
    const folder = fixtureFolder("multi-root");
    jest
      .spyOn(workspace, "getConfiguration")
      .mockImplementation((_section, scope) =>
        configuration(
          scope === folder.uri ? ["projects/general"] : ["projects/sox"],
        ),
      );

    const result = resolveDeclaredProjectRoots(folder);

    expect(workspace.getConfiguration).toHaveBeenCalledWith(
      CONFIGURATION_SECTION,
      folder.uri,
    );
    expect(rootPaths(result)).toEqual([
      fixturePath("multi-root", "projects/general"),
    ]);
    expect(result).toMatchObject({ source: "explicit", problems: [] });
  });

  it("never sees an undeclared copied project", () => {
    const folder = fixtureFolder("multi-root");
    mockProjects(["projects/general"]);

    expect(rootPaths(resolveDeclaredProjectRoots(folder))).toEqual([
      fixturePath("multi-root", "projects/general"),
    ]);
  });

  it("returns no fallback root when the folder is not a project", () => {
    mockProjects([]);

    expect(
      resolveDeclaredProjectRoots(fixtureFolder("nested-project")),
    ).toEqual({
      folder: fixtureFolder("nested-project"),
      roots: [],
      source: "folderRoot",
      problems: [],
    });
  });

  it("never enumerates projects or creates a watcher", () => {
    const findFiles = jest.spyOn(workspace, "findFiles");
    const createWatcher = jest.spyOn(workspace, "createFileSystemWatcher");
    mockProjects([]);

    resolveDeclaredProjectRoots(fixtureFolder("single-project"));

    expect(findFiles).not.toHaveBeenCalled();
    expect(createWatcher).not.toHaveBeenCalled();
  });

  it("falls back to a workspace-folder root project", () => {
    const folder = fixtureFolder("single-project");
    mockProjects([]);

    const result = resolveDeclaredProjectRoots(folder);

    expect(result.roots).toEqual([folder.uri]);
    expect(result).toMatchObject({ source: "folderRoot", problems: [] });
  });

  it("reports a missing explicit root", () => {
    const folder = fixtureFolder("multi-root");
    mockProjects(["projects/typo"]);

    const result = resolveDeclaredProjectRoots(folder);

    expect(result.roots).toEqual([]);
    expect(result.problems).toEqual([
      {
        reason: "missingProjectFile",
        entry: "projects/typo",
        root: fixturePath("multi-root", "projects/typo"),
      },
    ]);
  });

  it("fails closed when any explicit root is invalid", () => {
    const folder = fixtureFolder("multi-root");
    mockProjects(["projects/general", "projects/typo"]);

    const result = resolveDeclaredProjectRoots(folder);

    expect(result.roots).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });

  it("never falls back after an explicit failure", () => {
    mockProjects(["nope"]);

    const result = resolveDeclaredProjectRoots(fixtureFolder("single-project"));

    expect(result).toMatchObject({
      roots: [],
      source: "explicit",
      problems: [expect.objectContaining({ reason: "missingProjectFile" })],
    });
  });

  it("accepts an absolute root", () => {
    const root = fixturePath("multi-root", "projects/sox");
    mockProjects([root]);

    expect(
      rootPaths(resolveDeclaredProjectRoots(fixtureFolder("multi-root"))),
    ).toEqual([root]);
  });

  it("accepts a root outside the declaring folder", () => {
    const folder = fixtureFolder("nested-project");
    const root = fixturePath("multi-root", "projects/sox");
    mockProjects(["../multi-root/projects/sox"]);

    expect(rootPaths(resolveDeclaredProjectRoots(folder))).toEqual([root]);
  });

  it("preserves first declaration order while deduplicating", () => {
    const folder = fixtureFolder("multi-root");
    const general = fixturePath("multi-root", "projects/general");
    mockProjects([
      "projects/general",
      "projects/sox",
      "./projects/general/",
      general,
    ]);

    expect(rootPaths(resolveDeclaredProjectRoots(folder))).toEqual([
      general,
      fixturePath("multi-root", "projects/sox"),
    ]);
  });

  it("produces equal paths for registry deduplication across folders", () => {
    mockProjects(["projects/general"]);
    const first = resolveDeclaredProjectRoots(fixtureFolder("multi-root"));
    mockProjects(["../multi-root/projects/general"]);
    const second = resolveDeclaredProjectRoots(fixtureFolder("nested-project"));

    expect(rootPaths(first)).toEqual([
      fixturePath("multi-root", "projects/general"),
    ]);
    expect(rootPaths(first)).toEqual(rootPaths(second));
  });

  it("reports blank and non-string entries and fails closed", () => {
    mockProjects(["", "   ", 3, null]);

    const result = resolveDeclaredProjectRoots(fixtureFolder("multi-root"));

    expect(result.roots).toEqual([]);
    expect(result.problems).toEqual([
      { reason: "invalidEntry", entry: "" },
      { reason: "invalidEntry", entry: "   " },
      { reason: "invalidEntry", entry: "3" },
      { reason: "invalidEntry", entry: "null" },
    ]);
  });

  it("treats a non-array setting as absent", () => {
    const folder = fixtureFolder("single-project");
    mockProjects("projects/general");

    expect(resolveDeclaredProjectRoots(folder)).toMatchObject({
      roots: [folder.uri],
      source: "folderRoot",
      problems: [],
    });
  });
});

function fixtureFolder(name: string): WorkspaceFolder {
  return {
    uri: Uri.file(fixturePath(name)),
    name,
    index: 0,
  };
}

function fixturePath(...parts: string[]): string {
  return path.join(fixturesRoot, ...parts);
}

function mockProjects(value: unknown): void {
  jest
    .spyOn(workspace, "getConfiguration")
    .mockReturnValue(configuration(value));
}

function configuration(value: unknown): WorkspaceConfiguration {
  return {
    get: (key: string, fallback: unknown) =>
      key === PROJECTS_SETTING ? value : fallback,
  } as WorkspaceConfiguration;
}

function rootPaths(result: { roots: Uri[] }): string[] {
  return result.roots.map((root) => root.fsPath);
}
