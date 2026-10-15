import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import { findProjectRootForFile } from "../../projects/registry/projectDiscovery";

describe("findProjectRootForFile", () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs
      .splice(0)
      .forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  );
  const tmp = () => {
    const d = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "fpu-disc-")),
    );
    dirs.push(d);
    return d;
  };
  const folderOf = (dir: string): WorkspaceFolder => ({
    uri: Uri.file(dir),
    name: path.basename(dir),
    index: 0,
  });
  const touch = (...parts: string[]) => {
    const p = path.join(...parts);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "");
    return Uri.file(p);
  };
  const find = (file: Uri, dir: string) =>
    findProjectRootForFile(file, folderOf(dir))?.fsPath;

  it("finds the nearest root", () => {
    const d = tmp();
    touch(d, "dbt_project.yml");
    touch(d, "inner", "dbt_project.yml");
    const file = touch(d, "inner", "models", "a.sql");
    expect(find(file, d)).toBe(path.join(d, "inner"));
    expect(find(touch(d, "other", "b.sql"), d)).toBe(d);
  });

  it("accepts dbt_project.yaml", () => {
    const d = tmp();
    touch(d, "p", "dbt_project.yaml");
    expect(find(touch(d, "p", "models", "a.sql"), d)).toBe(path.join(d, "p"));
  });

  it("accepts a directory whose name starts with two dots", () => {
    const d = tmp();
    touch(d, "dbt_project.yml");
    expect(find(touch(d, "..scratch", "models", "a.sql"), d)).toBe(d);
  });

  it("returns undefined without a project file", () => {
    const d = tmp();
    expect(find(touch(d, "a", "b.sql"), d)).toBeUndefined();
  });

  it.each(["node_modules", "dbt_packages", "dbt_internal_packages", "target"])(
    "ignores files under %s",
    (excluded) => {
      const d = tmp();
      touch(d, "dbt_project.yml");
      touch(d, excluded, "pkg", "dbt_project.yml");
      expect(find(touch(d, excluded, "pkg", "m.sql"), d)).toBeUndefined();
    },
  );

  it("does not look above the folder root", () => {
    const d = tmp();
    touch(d, "dbt_project.yml");
    const folder = path.join(d, "sub");
    const file = touch(folder, "a.sql");
    expect(find(file, folder)).toBeUndefined();
  });

  it("ignores files outside the folder", () => {
    const d = tmp();
    const other = tmp();
    touch(other, "dbt_project.yml");
    expect(find(touch(other, "a.sql"), d)).toBeUndefined();
  });

  it("uses the injected existence check", () => {
    const d = tmp();
    const file = touch(d, "p", "a.sql");
    const root = path.join(d, "p", "dbt_project.yaml");
    expect(
      findProjectRootForFile(file, folderOf(d), (p) => p === root)?.fsPath,
    ).toBe(path.join(d, "p"));
  });

  it("resolves a symlinked folder", () => {
    const d = tmp();
    touch(d, "real", "dbt_project.yml");
    const file = touch(d, "real", "models", "a.sql");
    const link = path.join(d, "link");
    fs.symlinkSync(path.join(d, "real"), link);
    expect(find(Uri.file(path.join(link, "models", "a.sql")), link)).toBe(
      path.join(link),
    );
    expect(find(file, link)).toBe(link);
  });
});
