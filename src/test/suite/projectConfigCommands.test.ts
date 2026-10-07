import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { commands, ConfigurationTarget, Uri, window, workspace } from "vscode";
import {
  applyProjectConfigInsertion,
  ProjectConfigCommands,
} from "../../features/projectSetup/projectConfigCommands";
import { DeclaredProject } from "../../projects/projectRegistry";
import { flushAsync } from "../async";

const strict = (name: string) => ({
  path: ["models", name, "+static_analysis"],
  value: "strict",
});

describe("applyProjectConfigInsertion", () => {
  let dir = "";
  const terminal = { warn: vi.fn() } as any;

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
      save: vi.fn(() => Promise.resolve(true)),
    };
  }

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("applies the edit after the modal confirms, and saves", async () => {
    const yaml = "name: jaffle\n";
    const declared = project(yaml);
    const document = fakeDocument(yaml);
    (workspace.openTextDocument as Mock).mockReturnValue(
      Promise.resolve(document),
    );
    const modal = vi
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
    const edit = (workspace.applyEdit as Mock).mock.calls[0][0];
    expect(edit.replacements[0].newText).toContain("+static_analysis: strict");
    expect(document.save).toHaveBeenCalled();
  });

  it("writes nothing when the modal is dismissed", async () => {
    const declared = project("name: jaffle\n");
    vi.spyOn(window, "showInformationMessage").mockResolvedValue(undefined);

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
    const info = vi
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue(undefined);

    expect(await applyProjectConfigInsertion(declared, strict, terminal)).toBe(
      false,
    );
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain("already set");
    expect(workspace.applyEdit).not.toHaveBeenCalled();
  });

  it("uses the name in dbt_project.yml over the Declared Project name", async () => {
    const declared = project("name: real_name\n");
    const modal = vi
      .spyOn(window, "showInformationMessage")
      .mockResolvedValue(undefined);

    await applyProjectConfigInsertion(declared, strict, terminal);

    expect((modal.mock.calls[0][1] as any).detail).toContain("real_name:");
  });

  it("logs a parse failure to the resolved project's log", async () => {
    const declared = project("name: [unclosed\n");
    const projectLog = { warn: vi.fn() };
    const logFor = vi.fn(() => projectLog as never);
    const commandsDisposable = new ProjectConfigCommands(
      { whenSettled: () => Promise.resolve() },
      { requireForCommand: () => Promise.resolve(declared) } as never,
      logFor,
    );
    const registration = (commands.registerCommand as Mock).mock.calls.find(
      ([command]) => command === "fusionPowerUser.enableStrictAnalysis",
    );

    expect(await registration![1]()).toBe(false);
    expect(logFor).toHaveBeenCalledWith(declared.root);
    expect(projectLog.warn).toHaveBeenCalledWith(
      "projectConfigEdit",
      expect.any(String),
    );
    commandsDisposable.dispose();
  });
});

describe("fusionPowerUser.useStrictAnalysis", () => {
  const root = Uri.file("/workspace/general/jaffle");
  const declared = {
    root,
    name: "jaffle",
    folder: { name: "general" },
  } as DeclaredProject;
  let registered: ProjectConfigCommands | undefined;

  function register(
    requireForCommand: Mock,
    projectLog: { warn: Mock } = { warn: vi.fn() },
  ) {
    registered = new ProjectConfigCommands(
      { whenSettled: () => Promise.resolve() },
      { requireForCommand } as never,
      () => projectLog as never,
    );
    const registration = (commands.registerCommand as Mock).mock.calls.findLast(
      ([command]) => command === "fusionPowerUser.useStrictAnalysis",
    );
    return registration![1] as (root?: Uri) => Promise<boolean>;
  }

  afterEach(() => {
    registered?.dispose();
    vi.clearAllMocks();
  });

  it("writes the folder-scoped setting for the given project root", async () => {
    const update = vi.fn(() => Promise.resolve());
    (workspace.getConfiguration as Mock).mockReturnValueOnce({ update });
    const requireForCommand = vi.fn().mockResolvedValue(declared);

    expect(await register(requireForCommand)(root)).toBe(true);

    expect(requireForCommand).toHaveBeenCalledWith(root);
    expect(workspace.getConfiguration).toHaveBeenLastCalledWith(
      "fusionPowerUser",
      root,
    );
    expect(update).toHaveBeenCalledWith(
      "staticAnalysis",
      "strict",
      ConfigurationTarget.WorkspaceFolder,
    );
  });

  it("resolves the project through requireForCommand from the Command Palette", async () => {
    const update = vi.fn(() => Promise.resolve());
    (workspace.getConfiguration as Mock).mockReturnValueOnce({ update });
    const requireForCommand = vi.fn().mockResolvedValue(declared);

    expect(await register(requireForCommand)()).toBe(true);

    expect(requireForCommand).toHaveBeenCalledWith(undefined);
    expect(workspace.getConfiguration).toHaveBeenLastCalledWith(
      "fusionPowerUser",
      root,
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it("writes nothing when no project is current or picked", async () => {
    const requireForCommand = vi.fn().mockResolvedValue(undefined);

    expect(await register(requireForCommand)()).toBe(false);

    expect(workspace.getConfiguration).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("logs a failed write to the project's channel and offers that channel", async () => {
    const update = vi.fn(() => Promise.reject(new Error("read-only")));
    (workspace.getConfiguration as Mock).mockReturnValueOnce({ update });
    const projectLog = { warn: vi.fn() };
    (window.showErrorMessage as Mock).mockResolvedValueOnce("Show output");

    expect(
      await register(vi.fn().mockResolvedValue(declared), projectLog)(),
    ).toBe(false);
    await flushAsync();

    expect(projectLog.warn).toHaveBeenCalledWith(
      "useStrictAnalysis",
      "read-only",
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "jaffle: Could not set fusionPowerUser.staticAnalysis for the folder general: read-only",
      "Show output",
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "fusionPowerUser.showFusionOutput",
      root,
    );
  });
});
