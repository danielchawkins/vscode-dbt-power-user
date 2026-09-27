import { afterEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  isDbtTemplateFile,
  resolveProjectPaths,
} from "../../dbt_integration/projectPaths";

describe("resolveProjectPaths", () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs
      .splice(0)
      .forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  );
  const project = (yaml?: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-paths-"));
    dirs.push(root);
    if (yaml !== undefined) {
      fs.writeFileSync(path.join(root, "dbt_project.yml"), yaml);
    }
    return root;
  };

  it("uses dbt's standard layout when nothing is declared", () => {
    const root = project("name: p\n");
    expect(resolveProjectPaths(root)).toEqual({
      modelPaths: [path.join(root, "models")],
      seedPaths: [path.join(root, "seeds")],
      macroPaths: [path.join(root, "macros")],
      snapshotPaths: [path.join(root, "snapshots")],
      analysisPaths: [path.join(root, "analyses")],
      testPaths: [path.join(root, "tests")],
      targetPath: path.join(root, "target"),
      packagesInstallPath: path.join(root, "dbt_packages"),
    });
  });

  it("uses declared paths, including legacy snake_case keys", () => {
    const root = project(
      "name: p\nmodel-paths: [transform, marts]\nmacro_paths: [lib]\ntarget-path: build\n",
    );
    const paths = resolveProjectPaths(root);
    expect(paths.modelPaths).toEqual([
      path.join(root, "transform"),
      path.join(root, "marts"),
    ]);
    expect(paths.macroPaths).toEqual([path.join(root, "lib")]);
    expect(paths.targetPath).toEqual(path.join(root, "build"));
    expect(paths.seedPaths).toEqual([path.join(root, "seeds")]);
  });

  it.each([
    ["missing file", undefined],
    ["malformed yaml", "name: [unclosed\n"],
    ["wrong shapes", "model-paths: models\ntarget-path: [a]\n"],
  ])("falls back to defaults for %s", (_label, yaml) => {
    const root = project(yaml);
    const paths = resolveProjectPaths(root);
    expect(paths.modelPaths).toEqual([path.join(root, "models")]);
    expect(paths.targetPath).toEqual(path.join(root, "target"));
  });
});

describe("isDbtTemplateFile", () => {
  const root = "/p";
  const paths = {
    modelPaths: ["/p/models"],
    seedPaths: ["/p/seeds"],
    macroPaths: ["/p/macros"],
    snapshotPaths: ["/p/snapshots"],
    analysisPaths: ["/p/analyses"],
    testPaths: ["/p/tests"],
    targetPath: "/p/target",
    packagesInstallPath: "/p/dbt_packages",
  };

  it.each([
    ["/p/models/stg/a.sql", true],
    ["/p/macros/m.sql", true],
    ["/p/snapshots/s.sql", true],
    ["/p/tests/t.sql", true],
    ["/p/dbt_packages/pkg/models/x.sql", true],
    ["/p/target/compiled/p/models/a.sql", false],
    ["/p/scripts/adhoc.sql", false],
    ["/p/models/a.yml", false],
    ["/p/models_old/a.sql", false],
  ])("%s → %s", (file, expected) => {
    expect(isDbtTemplateFile(paths, path.join(file))).toBe(expected);
    expect(root).toBe("/p");
  });
});

describe("isDbtTemplateFile across path aliases", () => {
  it("matches a file reached through a symlinked project root", () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-real-"));
    const link = `${real}-link`;
    fs.mkdirSync(path.join(real, "models"));
    fs.writeFileSync(path.join(real, "models", "a.sql"), "select 1");
    fs.symlinkSync(real, link);
    try {
      const paths = resolveProjectPaths(fs.realpathSync(real));
      expect(isDbtTemplateFile(paths, path.join(link, "models", "a.sql"))).toBe(
        true,
      );
      expect(
        isDbtTemplateFile(
          resolveProjectPaths(link),
          path.join(real, "models", "a.sql"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(link);
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});
