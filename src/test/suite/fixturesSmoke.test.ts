import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync, readdirSync } from "fs";
import * as path from "path";
import { parse } from "yaml";

const fixtures = path.resolve(__dirname, "../fixtures");
const workspaces = ["single-project", "multi-root", "nested-project"];

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

    expect(projectFiles).toHaveLength(5);
    for (const projectFile of projectFiles) {
      const parsed = parse(readFileSync(projectFile, "utf8")) as {
        name?: string;
        profile?: string;
      };
      expect(parsed.name).toEqual(expect.any(String));
      expect(parsed.profile).toEqual(expect.any(String));
      expect(
        existsSync(path.join(path.dirname(projectFile), "profiles.yml")),
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

  it("keeps nested-project without a root dbt_project.yml", () => {
    expect(
      existsSync(path.join(fixtures, "nested-project", "dbt_project.yml")),
    ).toBe(false);
  });

  it("keeps the deliberately broken ref in single-project", () => {
    const model = readFileSync(
      path.join(fixtures, "single-project", "models", "broken_ref.sql"),
      "utf8",
    );
    expect(model).toContain('ref("missing_model")');
  });
});
