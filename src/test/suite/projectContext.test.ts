import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as path from "path";
import { EventEmitter, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { ProjectContext } from "../../projects/projectContext";
import {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/projectRegistry";
import { ProjectQuickPick } from "../../quickpick/projectQuickPick";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace"),
  name: "workspace",
  index: 0,
};
const otherFolder: WorkspaceFolder = {
  uri: Uri.file("/other"),
  name: "other",
  index: 1,
};
const general = project("/workspace/projects/general", "general", folder);
const sox = project("/workspace/projects/sox", "sox", folder);
const other = project("/other/project", "other", otherFolder);

describe("ProjectContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (window.activeTextEditor as unknown) = undefined;
    jest.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(undefined);
  });

  it("tracks the active editor's Declared Project", () => {
    const harness = createHarness([general, sox]);
    const changed = jest.fn();
    harness.context.onDidChangeCurrent(changed);

    setEditor("/workspace/projects/general/models/one.sql");
    fireEditorChange();
    setEditor("/workspace/projects/general/models/two.sql");
    fireEditorChange();
    setEditor("/workspace/projects/sox/models/model.sql");
    fireEditorChange();

    expect(harness.context.current).toBe(sox);
    expect(changed.mock.calls).toEqual([[general], [sox]]);
  });

  it("returns undefined for a non-project file in a multi-project folder", () => {
    const harness = createHarness([general, sox]);
    setEditor("/workspace/pipelines/pipeline.sql");
    jest.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);

    expect(harness.context.current).toBeUndefined();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("uses the active folder only when it owns exactly one project", () => {
    setEditor("/workspace/pipelines/pipeline.sql");
    jest.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);

    expect(createHarness([general, other]).context.current).toBe(general);
    expect(
      createHarness([general, sox, other]).context.current,
    ).toBeUndefined();
  });

  it("uses the sole project when no resource or folder resolves", () => {
    expect(createHarness([general]).context.current).toBe(general);
    expect(createHarness([general, sox]).context.current).toBeUndefined();
    expect(createHarness([]).context.current).toBeUndefined();
  });

  it("resolves resources only through the registry", () => {
    const harness = createHarness([general, sox]);
    const copied = Uri.file(
      "/workspace/projects/general/.state_copy/models/copied.sql",
    );
    const outside = Uri.file("/workspace/pipelines/pipeline.sql");

    expect(harness.context.forResource(copied)).toBe(general);
    expect(harness.context.forResource(outside)).toBeUndefined();
  });

  it("infers command context without prompting", async () => {
    const harness = createHarness([general, sox]);
    setEditor("/workspace/projects/sox/models/model.sql");

    await expect(
      harness.context.requireForCommand(
        Uri.file("/workspace/projects/general/models/model.sql"),
      ),
    ).resolves.toBe(general);
    await expect(harness.context.requireForCommand()).resolves.toBe(sox);
    expect(harness.picker.declaredProjectPicker).not.toHaveBeenCalled();
  });

  it("prompts among multiple projects and preserves cancellation", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker
      .mockResolvedValueOnce(general)
      .mockResolvedValueOnce(undefined);

    await expect(harness.context.requireForCommand()).resolves.toBe(general);
    await expect(harness.context.requireForCommand()).resolves.toBeUndefined();
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledWith([
      general,
      sox,
    ]);
  });

  it("prompts when a file URI belongs to no Declared Project", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker.mockResolvedValue(general);

    await expect(
      harness.context.requireForCommand(
        Uri.file("/workspace/pipelines/pipeline.sql"),
      ),
    ).resolves.toBe(general);
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledWith([
      general,
      sox,
    ]);
  });

  it("handles zero or one project without prompting", async () => {
    const one = createHarness([general]);
    const none = createHarness([]);
    const untitled = {
      scheme: "untitled",
      fsPath: "",
      path: "Untitled-1",
    } as Uri;
    (window.activeTextEditor as unknown) = {
      document: { uri: untitled },
    };

    await expect(one.context.requireForCommand(untitled)).resolves.toBe(
      general,
    );
    await expect(
      one.context.requireForCommand(Uri.file("/workspace/pipelines/job.sql")),
    ).resolves.toBeUndefined();
    await expect(none.context.requireForCommand()).resolves.toBeUndefined();
    expect(one.picker.declaredProjectPicker).not.toHaveBeenCalled();
    expect(none.picker.declaredProjectPicker).not.toHaveBeenCalled();
  });

  it("reacts to registry changes and stops after disposal", () => {
    const editorDispose = jest.fn();
    jest
      .spyOn(window, "onDidChangeActiveTextEditor")
      .mockReturnValue({ dispose: editorDispose });
    const harness = createHarness([]);
    const changed = jest.fn();
    harness.context.onDidChangeCurrent(changed);
    setEditor("/workspace/projects/general/models/model.sql");

    harness.projects.push(general);
    harness.registryEmitter.fire();
    harness.registryEmitter.fire();
    harness.context.dispose();
    harness.projects.length = 0;
    harness.registryEmitter.fire();

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(general);
    expect(editorDispose).toHaveBeenCalledTimes(1);
  });

  it("is inert before the registry contains projects", () => {
    const harness = createHarness([]);
    const changed = jest.fn();
    harness.context.onDidChangeCurrent(changed);
    setEditor("/workspace/projects/general/models/model.sql");
    fireEditorChange();

    expect(harness.context.current).toBeUndefined();
    expect(harness.context.forResource(general.root)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });
});

function createHarness(initialProjects: DeclaredProject[]) {
  const projects = [...initialProjects];
  const registryEmitter = new EventEmitter<void>();
  const registry = {
    get projects() {
      return projects;
    },
    onDidChangeProjects: registryEmitter.event,
    findProject: jest.fn((uri: Uri) =>
      projects.find((candidate) => candidate.contains(uri)),
    ),
  } as unknown as ProjectRegistry;
  const picker = {
    declaredProjectPicker:
      jest.fn<
        (
          projects: readonly DeclaredProject[],
        ) => Promise<DeclaredProject | undefined>
      >(),
  };
  return {
    context: new ProjectContext(
      registry,
      picker as unknown as ProjectQuickPick,
    ),
    picker,
    projects,
    registryEmitter,
  };
}

function project(
  rootPath: string,
  name: string,
  owningFolder: WorkspaceFolder,
): DeclaredProject {
  return {
    root: Uri.file(rootPath),
    name,
    folder: owningFolder,
    contains: (uri) =>
      uri.fsPath === rootPath || uri.fsPath.startsWith(rootPath + path.sep),
    dispose: jest.fn(),
  };
}

function setEditor(fsPath: string): void {
  (window.activeTextEditor as unknown) = {
    document: { uri: Uri.file(fsPath) },
  };
}

function fireEditorChange(): void {
  for (const [listener] of (window.onDidChangeActiveTextEditor as jest.Mock)
    .mock.calls) {
    (listener as (editor: unknown) => void)(window.activeTextEditor);
  }
}
