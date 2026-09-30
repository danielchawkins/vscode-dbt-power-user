import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  associatedLanguage,
  dbtTemplateAssociations,
} from "../../dbt_integration/dbtAssociations";

const folder = path.join("/", "repo");
const at = (...parts: string[]) => path.join(folder, ...parts);

describe("associatedLanguage", () => {
  // The finance-pipelines workspace associations, verbatim.
  const financePipelines = {
    "**/models/**/*.sql": "jinja-sql",
    "**/seeds/**/*.sql": "jinja-sql",
    "**/snapshots/**/*.sql": "jinja-sql",
    "**/transformation/dbt/*/models/**/*.sql": "jinja-sql",
    "**/scripts/sql/**/*.sql": "snowflake-sql",
    "**/target*/compiled/**/*.sql": "snowflake-sql",
    "**/target*/run/**/*.sql": "snowflake-sql",
  };

  it.each([
    [at("transformation/dbt/fg/models/stg/a.sql"), "jinja-sql"],
    [
      at("transformation/dbt/fg/target/compiled/fg/models/a.sql"),
      "snowflake-sql",
    ],
    [
      at("transformation/dbt/fg/target.core/run/fg/models/a.sql"),
      "snowflake-sql",
    ],
    [at("scripts/sql/adhoc.sql"), "snowflake-sql"],
    [at("transformation/dbt/fg/macros/m.sql"), undefined],
  ])("%s → %s", (file, language) => {
    expect(associatedLanguage(financePipelines, folder, file)).toBe(language);
  });

  it("prefers the longer pattern when two match", () => {
    const associations = { "*.sql": "sql", "**/models/**/*.sql": "jinja-sql" };
    expect(associatedLanguage(associations, folder, at("models/a.sql"))).toBe(
      "jinja-sql",
    );
  });

  it("matches a pattern without a slash against the file name only", () => {
    expect(
      associatedLanguage(
        { "*.sql": "snowflake-sql" },
        folder,
        at("deep/x/a.sql"),
      ),
    ).toBe("snowflake-sql");
  });
});

describe("dbtTemplateAssociations", () => {
  it("writes one folder-relative glob per template path and skips paths outside the folder", () => {
    const project = at("transformation/dbt/fg");
    const paths = {
      modelPaths: [path.join(project, "models")],
      macroPaths: [
        path.join(project, "macros"),
        path.join("/", "elsewhere", "macros"),
      ],
      snapshotPaths: [path.join(project, "snapshots")],
      analysisPaths: [],
      testPaths: [path.join(project, "tests")],
      seedPaths: [],
      targetPath: path.join(project, "target"),
      packagesInstallPath: path.join(project, "dbt_packages"),
    };
    expect(dbtTemplateAssociations(folder, paths)).toEqual({
      "transformation/dbt/fg/models/**/*.sql": "jinja-sql",
      "transformation/dbt/fg/macros/**/*.sql": "jinja-sql",
      "transformation/dbt/fg/snapshots/**/*.sql": "jinja-sql",
      "transformation/dbt/fg/tests/**/*.sql": "jinja-sql",
    });
  });
});
