import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dbtProjectFilePath,
  hasDbtProjectFile,
  isDbtProjectFilePath,
  parseDbtProjectYaml,
  readDbtProjectFile,
} from "../../core/snapshot";

describe("readDbtProjectFile", () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs
      .splice(0)
      .forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  );
  const project = (yaml?: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-file-"));
    dirs.push(root);
    if (yaml !== undefined) {
      fs.writeFileSync(path.join(root, "dbt_project.yml"), yaml);
    }
    return root;
  };

  it("parses a mapping", () => {
    const file = readDbtProjectFile(project("name: p\nprofile: q\n"));
    expect(file).toEqual({
      kind: "parsed",
      text: "name: p\nprofile: q\n",
      config: { name: "p", profile: "q" },
    });
  });

  it("reads dbt_project.yaml when it is the only project file", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "dbt_project.yaml"), "name: y\n");
    expect(readDbtProjectFile(root)).toMatchObject({
      kind: "parsed",
      config: { name: "y" },
    });
    expect(dbtProjectFilePath(root)).toBe(path.join(root, "dbt_project.yaml"));
    expect(hasDbtProjectFile(root)).toBe(true);
  });

  it("prefers dbt_project.yml over .yaml", () => {
    const root = project("name: yml\n");
    fs.writeFileSync(path.join(root, "dbt_project.yaml"), "name: yaml\n");
    expect(readDbtProjectFile(root)).toMatchObject({ config: { name: "yml" } });
  });

  it("defaults to the .yml path when neither exists", () => {
    const root = project();
    expect(dbtProjectFilePath(root)).toBe(path.join(root, "dbt_project.yml"));
    expect(hasDbtProjectFile(root)).toBe(false);
  });

  it("reports a missing file", () => {
    expect(readDbtProjectFile(project())).toEqual({
      kind: "missing",
      config: {},
    });
  });

  it("reports a missing root directory as a missing file", () => {
    const file = path.join(project(), "plain");
    fs.writeFileSync(file, "");
    expect(readDbtProjectFile(file).kind).toBe("missing");
  });

  it("reports a read failure other than absence with its message", () => {
    const root = project();
    fs.mkdirSync(path.join(root, "dbt_project.yml"));
    const file = readDbtProjectFile(root);
    expect(file.kind).toBe("unreadable");
    expect(file).toHaveProperty("message", expect.stringContaining("EISDIR"));
    expect(file.config).toEqual({});
  });

  it("reports invalid YAML without throwing", () => {
    const file = readDbtProjectFile(project("name: [unclosed\n"));
    expect(file.kind).toBe("invalid");
    expect(file.config).toEqual({});
  });

  it("treats a non-mapping document as empty config", () => {
    expect(parseDbtProjectYaml("- a\n- b\n").config).toEqual({});
  });
});

describe("isDbtProjectFilePath", () => {
  it("matches both names regardless of which file exists", () => {
    const root = path.join(os.tmpdir(), "no-such-root");
    expect(isDbtProjectFilePath(root, path.join(root, "dbt_project.yml"))).toBe(
      true,
    );
    expect(
      isDbtProjectFilePath(root, path.join(root, "dbt_project.yaml")),
    ).toBe(true);
    expect(isDbtProjectFilePath(root, path.join(root, "other.yml"))).toBe(
      false,
    );
  });
});
