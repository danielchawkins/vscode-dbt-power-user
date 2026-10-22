import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { esmDirname } from "../esmDirname";

const fixtures = path.resolve(esmDirname(import.meta.url), "../fixtures");
const workspaces = [
  "single-project",
  "multi-root",
  "nested-project",
  "nested-roots",
  "lineage-groups",
  "lineage-layers",
];

/** The fixture workspace a project file belongs to, named by its first path segment under the fixtures directory. */
function workspaceOf(projectFile: string): string {
  return path.relative(fixtures, projectFile).split(path.sep)[0] ?? "";
}

/** The one project whose profile comes from its workspace's root `profiles.yml`; every other project needs its own. */
const ROOT_PROFILES_PROJECT = path.join("nested-roots", "inner");

function findProjectFiles(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => path.basename(file) === "dbt_project.yml")
    .map((file) => path.join(root, file))
    .sort();
}

describe("fixture workspaces", () => {
  it("parses every workspace dbt_project.yml as YAML with a profile", () => {
    const projectFiles = workspaces.flatMap((workspace) =>
      findProjectFiles(path.join(fixtures, workspace)),
    );

    expect(projectFiles).toHaveLength(9);
    for (const projectFile of projectFiles) {
      const parsed = parse(readFileSync(projectFile, "utf8")) as {
        name?: string;
        profile?: string;
      };
      expect(parsed.name).toEqual(expect.any(String));
      expect(parsed.profile).toEqual(expect.any(String));
      const projectDir = path.dirname(projectFile);
      const workspaceDir = path.join(fixtures, workspaceOf(projectFile));
      const usesRootProfiles =
        path.relative(fixtures, projectDir) === ROOT_PROFILES_PROJECT;
      expect(
        existsSync(path.join(projectDir, "profiles.yml")) ||
          existsSync(path.join(projectDir, "profiles", "profiles.yml")) ||
          (usesRootProfiles &&
            existsSync(path.join(workspaceDir, "profiles.yml"))),
      ).toBe(true);
    }
  });

  it("has exactly two multi-root projects and one state copy", () => {
    const root = path.join(fixtures, "multi-root");
    const relativeFiles = findProjectFiles(root).map((file) =>
      path.relative(root, file),
    );
    const stateCopies = relativeFiles.filter((file) =>
      file.split(path.sep).includes(".state_copy"),
    );
    const projectRoots = relativeFiles.filter(
      (file) => !file.split(path.sep).includes(".state_copy"),
    );

    expect(projectRoots).toEqual([
      path.join("projects", "general", "dbt_project.yml"),
      path.join("projects", "sox", "dbt_project.yml"),
    ]);
    expect(stateCopies).toEqual([
      path.join("projects", "general", ".state_copy", "dbt_project.yml"),
    ]);
  });

  it("opens multi-root as a workspace whose project folders name different profiles directories", () => {
    const root = path.join(fixtures, "multi-root");
    const workspaceFile = JSON.parse(
      readFileSync(path.join(root, "multi-root.code-workspace"), "utf8"),
    ) as { folders: { path: string }[] };
    expect(workspaceFile.folders.map((folder) => folder.path)).toEqual([
      "projects/general",
      "projects/sox",
      "pipelines",
    ]);
    const profilesDirs = ["general", "sox"].map(
      (name) =>
        (
          JSON.parse(
            readFileSync(
              path.join(root, "projects", name, ".vscode", "settings.json"),
              "utf8",
            ),
          ) as Record<string, string>
        )["fusionPowerUser.profilesDir"],
    );
    expect(new Set(profilesDirs).size).toBe(2);
    expect(existsSync(path.join(root, "projects", "sox", "profiles.yml"))).toBe(
      false,
    );
  });

  it("keeps nested-project without a root dbt_project.yml", () => {
    expect(
      existsSync(path.join(fixtures, "nested-project", "dbt_project.yml")),
    ).toBe(false);
  });

  it("points nested-project's profilesDir at its analytics project", () => {
    const settings = JSON.parse(
      readFileSync(
        path.join(fixtures, "nested-project", ".vscode", "settings.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(settings["fusionPowerUser.profilesDir"]).toBe(
      "${workspaceFolder}/projects/analytics",
    );
  });

  it("gives nested-roots an outer and an inner project sharing one profiles.yml", () => {
    const root = path.join(fixtures, "nested-roots");
    expect(
      findProjectFiles(root).map((file) => path.relative(root, file)),
    ).toEqual(["dbt_project.yml", path.join("inner", "dbt_project.yml")]);
    const profiles = parse(
      readFileSync(path.join(root, "profiles.yml"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(profiles).sort()).toEqual(["inner", "outer"]);
  });

  it("keeps the deliberately broken ref in single-project", () => {
    const model = readFileSync(
      path.join(fixtures, "single-project", "models", "broken_ref.sql"),
      "utf8",
    );
    expect(model).toContain('ref("missing_model")');
  });
});
