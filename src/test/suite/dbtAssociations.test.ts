import * as path from "path";
import { describe, expect, it } from "vitest";
import { ProjectPaths } from "../../core/project";
import { dbtTemplateAssociations } from "../../dbt_integration/dbtAssociations";
import { match } from "../vscodeGlob";

const slash = (p: string) => p.split(path.sep).join("/");

const pathsAt = (
  project: string,
  overrides: Partial<ProjectPaths> = {},
): ProjectPaths => ({
  modelPaths: [path.join(project, "models")],
  macroPaths: [path.join(project, "macros")],
  snapshotPaths: [path.join(project, "snapshots")],
  analysisPaths: [],
  testPaths: [path.join(project, "tests")],
  seedPaths: [path.join(project, "seeds")],
  targetPath: path.join(project, "target"),
  packagesInstallPath: path.join(project, "dbt_packages"),
  ...overrides,
});

const modelsOnly = (project: string, model: string) =>
  dbtTemplateAssociations(
    project,
    pathsAt(project, {
      modelPaths: [model],
      macroPaths: [],
      snapshotPaths: [],
      testPaths: [],
      packagesInstallPath: project,
    }),
  );

describe("dbtTemplateAssociations", () => {
  it("writes one absolute glob per template path, the packages path and paths outside the project", () => {
    const project = path.resolve("/repo/transformation/fg");
    const elsewhere = path.resolve("/elsewhere/macros");
    const paths = pathsAt(project, {
      macroPaths: [path.join(project, "macros"), elsewhere],
    });
    const p = slash(project);
    expect(dbtTemplateAssociations(project, paths)).toEqual({
      associations: {
        [`${p}/models/**/*.sql`]: "jinja-sql",
        [`${p}/macros/**/*.sql`]: "jinja-sql",
        [`${slash(elsewhere)}/**/*.sql`]: "jinja-sql",
        [`${p}/snapshots/**/*.sql`]: "jinja-sql",
        [`${p}/tests/**/*.sql`]: "jinja-sql",
        [`${p}/dbt_packages/**/*.sql`]: "jinja-sql",
      },
      skipped: [],
    });
  });

  it("wraps wildcards and brackets in a class and leaves ( ) ! literal", () => {
    const project = path.resolve("/Users/me/[work]/p}(x86)!?*");
    const { associations } = modelsOnly(project, path.join(project, "models"));
    expect(Object.keys(associations)).toEqual([
      `${slash(path.resolve("/Users/me"))}/[[]work[]]/p[}](x86)![?][*]/models/**/*.sql`,
    ]);
  });

  it.each(["(x86)", "!", "[work]", "*", "?", "}", "a]b", "[!x]"])(
    "matches only the literal directory containing %s",
    (part) => {
      const project = path.resolve("/repo", `p${part}q`);
      const { associations } = modelsOnly(
        project,
        path.join(project, "models"),
      );
      const [pattern] = Object.keys(associations);
      const file = `${slash(project)}/models/a/b.sql`;
      expect(match(pattern, file)).toBe(true);
      expect(
        match(pattern, `${slash(path.resolve("/repo/pxq"))}/models/b.sql`),
      ).toBe(false);
      expect(
        match(pattern, `${slash(project)}/target/compiled/p/models/b.sql`),
      ).toBe(false);
    },
  );

  it("skips a directory containing { and reports it", () => {
    const project = path.resolve("/repo/p{a,b}");
    const models = path.join(project, "models");
    expect(modelsOnly(project, models)).toEqual({
      associations: {},
      skipped: [
        { dir: models, reason: "brace" },
        { dir: project, reason: "projectRoot" },
      ],
    });
  });

  it("skips a directory equal to the project root and reports it", () => {
    const project = path.resolve("/tmp/p");
    const { associations, skipped } = dbtTemplateAssociations(
      project,
      pathsAt(project, { modelPaths: [project, path.join(project, "m")] }),
    );
    expect(associations).not.toHaveProperty(`${slash(project)}/**/*.sql`);
    expect(associations).toHaveProperty(
      `${slash(project)}/m/**/*.sql`,
      "jinja-sql",
    );
    expect(skipped).toEqual([{ dir: project, reason: "projectRoot" }]);
  });

  it("matches a win32 drive path case-insensitively", () => {
    const project = path.win32.resolve("C:\\Users\\Me\\proj");
    const pattern = `${project.split(path.win32.sep).join("/")}/models/**/*.sql`;
    expect(match(pattern, "c:\\users\\me\\PROJ\\models\\a\\b.sql", true)).toBe(
      true,
    );
    expect(match(pattern, "c:\\users\\me\\PROJ\\models\\a\\b.sql", false)).toBe(
      false,
    );
  });
});
