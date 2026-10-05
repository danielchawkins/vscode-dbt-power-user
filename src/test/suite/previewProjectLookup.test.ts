import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventEmitter,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
  WorkspaceFolder,
} from "vscode";
import type { Log } from "../../core/log";
import { CurrentProject } from "../../projects/currentProject";
import { previewUriFor } from "../../projects/previewUri";
import { Project } from "../../projects/project";
import { PROJECTS_SETTING } from "../../projects/projectConfiguration";
import { ProjectQuickPick } from "../../projects/projectQuickPick";
import { ProjectRegistry } from "../../projects/projectRegistry";
import { Projects } from "../../projects/projects";
import { esmDirname } from "../esmDirname";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

const workspaceRoot = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/multi-root",
);
const soxRoot = path.join(workspaceRoot, "projects/sox");
const soxModel = Uri.file(path.join(soxRoot, "models/sox_model.sql"));

describe("compiled preview project lookup", () => {
  const terminal = {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Log;
  const picker = { declaredProjectPicker: vi.fn() };
  let registry: ProjectRegistry;
  let projects: Projects;
  let currentProject: CurrentProject;

  const stubProject = ({ root }: { root: Uri }) =>
    ({
      projectRoot: root,
      initialize: vi.fn(),
      dispose: vi.fn(),
      onDidChangeManifest: new EventEmitter<Project>().event,
    }) as unknown as Project;

  beforeEach(async () => {
    const folder: WorkspaceFolder = {
      uri: Uri.file(workspaceRoot),
      name: "multi-root",
      index: 0,
    };
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: (key: string) =>
        key === PROJECTS_SETTING
          ? ["projects/general", "projects/sox"]
          : undefined,
    } as unknown as WorkspaceConfiguration);
    (workspace.workspaceFolders as unknown) = [folder];
    registry = new ProjectRegistry(terminal);
    await registry.initialize();
    projects = new Projects(registry, stubProject, terminal);
    await projects.initialize();
    currentProject = new CurrentProject(
      registry,
      picker as unknown as ProjectQuickPick,
    );
  });

  afterEach(() => {
    currentProject.dispose();
    projects.dispose();
    registry.dispose();
    (window.activeTextEditor as unknown) = undefined;
    (workspace.workspaceFolders as unknown) = [];
    vi.restoreAllMocks();
  });

  it("resolves a preview URI to its model's project", () => {
    expect(projects.get(previewUriFor(soxModel))?.projectRoot.fsPath).toBe(
      soxRoot,
    );
  });

  it("resolves the current project through a focused preview", async () => {
    const preview = previewUriFor(soxModel);
    (window.activeTextEditor as unknown) = { document: { uri: preview } };

    expect(currentProject.current?.root.fsPath).toBe(soxRoot);
    expect((await currentProject.requireForCommand(preview))?.name).toBe("sox");
    expect(picker.declaredProjectPicker).not.toHaveBeenCalled();
  });
});
