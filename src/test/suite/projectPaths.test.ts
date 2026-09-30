import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readDbtProjectFile, resolveProjectPaths } from "../../core/project";

const pathsOnDisk = (root: string) =>
  resolveProjectPaths(root, readDbtProjectFile(root).config);

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
    expect(pathsOnDisk(root)).toEqual({
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
    const paths = pathsOnDisk(root);
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
    const paths = pathsOnDisk(root);
    expect(paths.modelPaths).toEqual([path.join(root, "models")]);
    expect(paths.targetPath).toEqual(path.join(root, "target"));
  });
});
