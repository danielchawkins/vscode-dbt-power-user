import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { Uri, window, workspace } from "vscode";
import { applyProjectConfigInsertion } from "../../features/projectSetup/projectConfigCommands";
import { DeclaredProject } from "../../projects/projectRegistry";

const strict = (name: string) => ({
  path: ["models", name, "+static_analysis"],
  value: "strict",
});

describe("applyProjectConfigInsertion", () => {
  let dir = "";
  const terminal = { warn: jest.fn() } as any;

  function project(yaml: string): DeclaredProject {
    dir = mkdtempSync(path.join(tmpdir(), "fpu-config-edit-"));
    writeFileSync(path.join(dir, "dbt_project.yml"), yaml);
    return { root: Uri.file(dir), name: "jaffle" } as DeclaredProject;
  }

  function fakeDocument(text: string) {
    const lines = text.split("\n");
    return {
      lineCount: lines.length,
      lineAt: (line: number) => ({
        range: { end: { line, character: lines[line].length } },
      }),
      save: jest.fn(() => Promise.resolve(true)),
    };
  }

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("applies the edit after the modal confirms, and saves", async () => {
    const yaml = "name: jaffle\n";
    const declared = project(yaml);
    const document = fakeDocument(yaml);
    (workspace.openTextDocument as jest.Mock).mockReturnValue(
      Promise.resolve(document),
    );
    const modal = jest
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue("Add" as never);

    expect(await applyProjectConfigInsertion(declared, strict, terminal)).toBe(
      true,
    );

    expect(modal.mock.calls[0]).toEqual([
      "Add to jaffle/dbt_project.yml?",
      {
        modal: true,
        detail: "models:\n  jaffle:\n    +static_analysis: strict",
      },
      "Add",
    ]);
    const edit = (workspace.applyEdit as jest.Mock).mock.calls[0][0] as any;
    expect(edit.replacements[0].newText).toContain("+static_analysis: strict");
    expect(document.save).toHaveBeenCalled();
  });

  it("writes nothing when the modal is dismissed", async () => {
    const declared = project("name: jaffle\n");
    jest
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue(undefined as never);

    expect(await applyProjectConfigInsertion(declared, strict, terminal)).toBe(
      false,
    );
    expect(workspace.applyEdit).not.toHaveBeenCalled();
    expect(readFileSync(path.join(dir, "dbt_project.yml"), "utf8")).toBe(
      "name: jaffle\n",
    );
  });

  it("does not prompt when the key already exists", async () => {
    const declared = project(
      "name: jaffle\nmodels:\n  jaffle:\n    +static_analysis: baseline\n",
    );
    const info = jest
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue(undefined as never);

    expect(await applyProjectConfigInsertion(declared, strict, terminal)).toBe(
      false,
    );
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain("already set");
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("uses the name in dbt_project.yml over the Declared Project name", async () => {
    const declared = project("name: real_name\n");
    const modal = jest
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue(undefined as never);

    await applyProjectConfigInsertion(declared, strict, terminal);

    expect((modal.mock.calls[0][1] as any).detail).toContain("real_name:");
  });
});
