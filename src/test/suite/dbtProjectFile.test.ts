import { afterEach, describe, expect, it } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseDbtProjectYaml, readDbtProjectFile } from "../../core/project";

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
