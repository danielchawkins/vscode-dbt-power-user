import type { Disposable, Event, TextEditor, Uri } from "vscode";
import { commands, EventEmitter, window, workspace } from "vscode";
import { disposeAll } from "../../core/disposables";
import type { FolderScope } from "../../core/snapshot/schemaOrigin";
import { folderScopeOf } from "../../core/snapshot/schemaOrigin";
import { activeModelUri } from "../registry/previewUri";
import type {
  DeclaredProject,
  ProjectRegistry,
} from "../registry/projectRegistry";
import type { Project } from "./project";
import type { ProjectQuickPick } from "./projectQuickPick";
import type { Projects } from "./projects";

/** The active editor, the model it stands for, and the Project that owns it. */
export interface ActiveEditor {
  readonly editor: TextEditor;
  /** The model the editor stands for: a compiled preview resolves to its model. */
  readonly modelUri: Uri;
  readonly project: Project | undefined;
}

/** The Project that owns the file or command currently being handled. */
export class CurrentProject implements Disposable {
  private readonly _onDidChangeCurrent = new EventEmitter<
    Project | undefined
  >();
  private lastEmittedCurrent: Project | undefined;
  private selectedProject: DeclaredProject | undefined;
  private subscriptions: Disposable[] = [];
  private registry: ProjectRegistry;
  private projects: Projects;
  private projectQuickPick: ProjectQuickPick;

  constructor(
    registry: ProjectRegistry,
    projects: Projects,
    projectQuickPick: ProjectQuickPick,
  ) {
    this.registry = registry;
    this.projects = projects;
    this.projectQuickPick = projectQuickPick;
    this.subscriptions.push(
      window.onDidChangeActiveTextEditor(() => this.updateCurrent()),
      registry.onDidChangeProjects(() => this.updateCurrent()),
      projects.onDidChangeProjects(() => this.updateCurrent()),
    );
    this.publishInProject();
  }

  /** Active editor/folder project, retained non-file pick, then the sole project. */
  get current(): Project | undefined {
    return this.forResource();
  }

  /** The active editor with the model it stands for and its Project; `undefined` when no editor is active. */
  activeEditor(): ActiveEditor | undefined {
    const editor = window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    return {
      editor,
      modelUri: activeModelUri(editor.document.uri),
      project: this.forResource(editor.document.uri),
    };
  }

  get onDidChangeCurrent(): Event<Project | undefined> {
    return this._onDidChangeCurrent.event;
  }

  /** The workspace folder of the Current Project and how many Declared Projects share its settings. */
  folderScope(): FolderScope | undefined {
    const declared = this.declaredFor(window.activeTextEditor?.document.uri);
    return declared && folderScopeOf(this.registry.projects, declared);
  }

  /**
   * The Project owning a resource, of the active editor when omitted: a compiled preview resolves to its model, then
   * the containing Declared Project, then the folder's only one, then the picked or sole project.
   */
  forResource(
    uri: Uri | undefined = window.activeTextEditor?.document.uri,
  ): Project | undefined {
    return this.projectOf(this.declaredFor(uri));
  }

  /** The Project with the dbt project name a query run names. */
  byName(projectName: string): Project | undefined {
    return this.projects.byName(projectName);
  }

  /** The Project for a command run from the active editor; prompts only when it cannot be inferred. */
  requireForActiveEditor(): Promise<Project | undefined> {
    return this.requireForCommand(window.activeTextEditor?.document.uri);
  }

  /** Prompts only when a user-invoked command needs a project and cannot infer one. */
  async requireForCommand(commandUri?: Uri): Promise<Project | undefined> {
    const uri = commandUri && activeModelUri(commandUri);
    if (uri?.scheme === "file") {
      const project = this.forResource(uri);
      if (project) {
        return project;
      }
      return this.registry.projects.length >= 2
        ? this.projectOf(
            await this.projectQuickPick.declaredProjectPicker(
              this.registry.projects,
            ),
          )
        : undefined;
    }

    const current = this.current;
    if (current) {
      return current;
    }

    if (this.registry.projects.length < 2) {
      return undefined;
    }

    return this.pickForCommand();
  }

  async pickForCommand(): Promise<Project | undefined> {
    const declared = await this.projectQuickPick.declaredProjectPicker(
      this.registry.projects,
    );
    if (declared) {
      this.selectedProject = declared;
      this.updateCurrent();
    }
    return this.projectOf(declared);
  }

  dispose(): void {
    disposeAll(this.subscriptions);
    this._onDidChangeCurrent.dispose();
  }

  private declaredFor(uri: Uri | undefined): DeclaredProject | undefined {
    const activeUri = uri && activeModelUri(uri);
    if (activeUri) {
      const project = this.registry.findProject(activeUri);
      if (project) {
        return project;
      }
      const folder = workspace.getWorkspaceFolder(activeUri);
      if (folder) {
        const projectsInFolder = this.registry.projects.filter(
          (candidate) => candidate.folder.uri.fsPath === folder.uri.fsPath,
        );
        if (projectsInFolder.length === 1) {
          return projectsInFolder[0];
        }
      }
    }

    if (activeUri?.scheme !== "file" && this.selectedProject) {
      return this.selectedProject;
    }

    if (this.registry.projects.length === 1) {
      return this.registry.projects[0];
    }
    return undefined;
  }

  /** The Project the Projects service built for a Declared Project; `undefined` until it has synchronized. */
  private projectOf(
    declared: DeclaredProject | undefined,
  ): Project | undefined {
    return declared && this.projects.get(declared.root);
  }

  /** Backs the `fusionPowerUser.inProject` key that gates dbt editor actions on SQL files. */
  private publishInProject(): void {
    const uri = window.activeTextEditor?.document.uri;
    const activeUri = uri && activeModelUri(uri);
    const inProject =
      activeUri !== undefined && !!this.registry.findProject(activeUri);
    void commands.executeCommand(
      "setContext",
      "fusionPowerUser.inProject",
      inProject,
    );
  }

  private updateCurrent(): void {
    this.publishInProject();
    if (
      this.selectedProject &&
      !this.registry.projects.includes(this.selectedProject)
    ) {
      this.selectedProject = undefined;
    }
    const newCurrent = this.current;
    if (newCurrent !== this.lastEmittedCurrent) {
      this.lastEmittedCurrent = newCurrent;
      this._onDidChangeCurrent.fire(newCurrent);
    }
  }
}
