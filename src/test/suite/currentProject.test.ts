import * as path from "node:path";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { WorkspaceFolder } from "vscode";
import type * as vscodeApi from "vscode";
import { EventEmitter, Uri, window, workspace } from "vscode";
import { CurrentProject } from "../../projects/project/currentProject";
import type { Project } from "../../projects/project/project";
import type { ProjectQuickPick } from "../../projects/project/projectQuickPick";
import type { Projects } from "../../projects/project/projects";
import { previewUriFor } from "../../projects/registry/previewUri";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../../projects/registry/projectRegistry";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof vscodeApi>()),
  Uri: (await import("vscode-uri")).URI,
}));

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

/** The Project the Projects service built for a Declared Project; one stub per root, so identity holds. */
const projectStubs = new Map<string, Project>();
function projectOf(declared: DeclaredProject): Project {
  let stub = projectStubs.get(declared.root.fsPath);
  if (!stub) {
    stub = {
      declared,
      projectRoot: declared.root,
      getProjectName: () => declared.name,
    } as unknown as Project;
    projectStubs.set(declared.root.fsPath, stub);
  }
  return stub;
}

describe("CurrentProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.activeTextEditor as unknown) = undefined;
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(undefined);
  });

  it("tracks the active editor's Declared Project", () => {
    const harness = createHarness([general, sox]);
    const changed = vi.fn();
    harness.context.onDidChangeCurrent(changed);

    setEditor("/workspace/projects/general/models/one.sql");
    fireEditorChange();
    setEditor("/workspace/projects/general/models/two.sql");
    fireEditorChange();
    setEditor("/workspace/projects/sox/models/model.sql");
    fireEditorChange();

    expect(harness.context.current).toBe(projectOf(sox));
    expect(changed.mock.calls).toEqual([
      [projectOf(general)],
      [projectOf(sox)],
    ]);
  });

  it("returns undefined for a non-project file in a multi-project folder", () => {
    const harness = createHarness([general, sox]);
    setEditor("/workspace/pipelines/pipeline.sql");
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);

    expect(harness.context.current).toBeUndefined();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("uses the active folder only when it owns exactly one project", () => {
    setEditor("/workspace/pipelines/pipeline.sql");
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);

    expect(createHarness([general, other]).context.current).toBe(
      projectOf(general),
    );
    expect(
      createHarness([general, sox, other]).context.current,
    ).toBeUndefined();
  });

  it("uses the sole project when no resource or folder resolves", () => {
    expect(createHarness([general]).context.current).toBe(projectOf(general));
    expect(createHarness([general, sox]).context.current).toBeUndefined();
    expect(createHarness([]).context.current).toBeUndefined();
  });

  it("resolves resources only through the registry", () => {
    const harness = createHarness([general, sox]);
    const copied = Uri.file(
      "/workspace/projects/general/.state_copy/models/copied.sql",
    );
    const outside = Uri.file("/workspace/pipelines/pipeline.sql");

    expect(harness.context.forResource(copied)).toBe(projectOf(general));
    expect(harness.context.forResource(outside)).toBeUndefined();
  });

  it("infers command context without prompting", async () => {
    const harness = createHarness([general, sox]);
    setEditor("/workspace/projects/sox/models/model.sql");

    await expect(
      harness.context.requireForCommand(
        Uri.file("/workspace/projects/general/models/model.sql"),
      ),
    ).resolves.toBe(projectOf(general));
    await expect(harness.context.requireForCommand()).resolves.toBe(
      projectOf(sox),
    );
    expect(harness.picker.declaredProjectPicker).not.toHaveBeenCalled();
  });

  it("prompts among multiple projects and retains the selection", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker.mockResolvedValue(general);

    await expect(harness.context.requireForCommand()).resolves.toBe(
      projectOf(general),
    );
    await expect(harness.context.requireForCommand()).resolves.toBe(
      projectOf(general),
    );
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledWith([
      general,
      sox,
    ]);
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledTimes(1);
  });

  it("preserves project-pick cancellation", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker.mockResolvedValue(undefined);

    await expect(harness.context.requireForCommand()).resolves.toBeUndefined();
  });

  it("retains an explicit pick for path-free commands only", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker.mockResolvedValue(sox);
    const untitled = {
      scheme: "untitled",
      fsPath: "",
      path: "Untitled-1",
    } as Uri;

    await expect(harness.context.pickForCommand()).resolves.toBe(
      projectOf(sox),
    );
    await expect(harness.context.requireForCommand(untitled)).resolves.toBe(
      projectOf(sox),
    );
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledTimes(1);

    setEditor("/workspace/pipelines/pipeline.sql");
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);
    expect(harness.context.current).toBeUndefined();
  });

  it("prompts when a file URI belongs to no Declared Project", async () => {
    const harness = createHarness([general, sox]);
    harness.picker.declaredProjectPicker
      .mockResolvedValueOnce(general)
      .mockResolvedValueOnce(sox);

    await expect(
      harness.context.requireForCommand(
        Uri.file("/workspace/pipelines/pipeline.sql"),
      ),
    ).resolves.toBe(projectOf(general));
    await expect(harness.context.requireForCommand()).resolves.toBe(
      projectOf(sox),
    );
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledWith([
      general,
      sox,
    ]);
    expect(harness.picker.declaredProjectPicker).toHaveBeenCalledTimes(2);
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
      projectOf(general),
    );
    await expect(
      one.context.requireForCommand(Uri.file("/workspace/pipelines/job.sql")),
    ).resolves.toBe(projectOf(general));
    await expect(none.context.requireForCommand()).resolves.toBeUndefined();
    expect(one.picker.declaredProjectPicker).not.toHaveBeenCalled();
    expect(none.picker.declaredProjectPicker).not.toHaveBeenCalled();
  });

  it("reacts to registry changes and stops after disposal", () => {
    const editorDispose = vi.fn();
    vi.spyOn(window, "onDidChangeActiveTextEditor").mockReturnValue({
      dispose: editorDispose,
    });
    const harness = createHarness([]);
    const changed = vi.fn();
    harness.context.onDidChangeCurrent(changed);
    setEditor("/workspace/projects/general/models/model.sql");

    harness.projects.push(general);
    harness.registryEmitter.fire();
    harness.registryEmitter.fire();
    harness.context.dispose();
    harness.projects.length = 0;
    harness.registryEmitter.fire();

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(projectOf(general));
    expect(editorDispose).toHaveBeenCalledTimes(1);
  });

  it("resolves a compiled preview to its model's Project and model", () => {
    const harness = createHarness([general, sox]);
    const model = Uri.file("/workspace/projects/sox/models/model.sql");
    (window.activeTextEditor as unknown) = {
      document: { uri: previewUriFor(model) },
    };

    expect(harness.context.current).toBe(projectOf(sox));
    expect(harness.context.activeEditor()?.modelUri.fsPath).toBe(model.fsPath);
    expect(harness.context.activeEditor()?.project).toBe(projectOf(sox));
  });

  it("falls back to the folder's only Project for a compiled preview", () => {
    const harness = createHarness([general, other]);
    const model = Uri.file("/workspace/pipelines/pipeline.sql");
    (window.activeTextEditor as unknown) = {
      document: { uri: previewUriFor(model) },
    };
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder);

    expect(harness.context.current).toBe(projectOf(general));
    expect(harness.context.activeEditor()?.modelUri.fsPath).toBe(model.fsPath);
  });

  it("is inert before the registry contains projects", () => {
    const harness = createHarness([]);
    const changed = vi.fn();
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
    findProject: vi.fn((uri: Uri) =>
      projects.find((candidate) => candidate.contains(uri)),
    ),
  } as unknown as ProjectRegistry;
  const projectsService = {
    get: (uri: Uri) => {
      const declared = projects.find(
        (candidate) => candidate.root.fsPath === uri.fsPath,
      );
      return declared && projectOf(declared);
    },
    onDidChangeProjects: new EventEmitter<void>().event,
  } as unknown as Projects;
  const picker = {
    declaredProjectPicker:
      vi.fn<
        (
          projects: readonly DeclaredProject[],
        ) => Promise<DeclaredProject | undefined>
      >(),
  };
  return {
    context: new CurrentProject(
      registry,
      projectsService,
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
    origin: "explicit",
    contains: (uri) =>
      uri.fsPath === rootPath || uri.fsPath.startsWith(rootPath + path.sep),
    dispose: vi.fn(),
  };
}

function setEditor(fsPath: string): void {
  (window.activeTextEditor as unknown) = {
    document: { uri: Uri.file(fsPath) },
  };
}

function fireEditorChange(): void {
  for (const [listener] of (window.onDidChangeActiveTextEditor as Mock).mock
    .calls) {
    (listener as (editor: unknown) => void)(window.activeTextEditor);
  }
}
