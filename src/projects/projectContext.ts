import {
  Disposable,
  Event,
  EventEmitter,
  Uri,
  window,
  workspace,
} from "vscode";
import { ProjectQuickPick } from "../quickpick/projectQuickPick";
import { DeclaredProject, ProjectRegistry } from "./projectRegistry";

/** The Declared Project that owns the file or command currently being handled. */
export class ProjectContext implements Disposable {
  private readonly _onDidChangeCurrent = new EventEmitter<
    DeclaredProject | undefined
  >();
  private lastEmittedCurrent: DeclaredProject | undefined;
  private subscriptions: Disposable[] = [];

  constructor(
    private registry: ProjectRegistry,
    private projectQuickPick: ProjectQuickPick,
  ) {
    this.subscriptions.push(
      window.onDidChangeActiveTextEditor(() => this.updateCurrent()),
      registry.onDidChangeProjects(() => this.updateCurrent()),
    );
  }

  /** Active editor's project, else the active folder's sole project, else the sole project. */
  get current(): DeclaredProject | undefined {
    const activeUri = window.activeTextEditor?.document.uri;
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

    if (this.registry.projects.length === 1) {
      return this.registry.projects[0];
    }
    return undefined;
  }

  get onDidChangeCurrent(): Event<DeclaredProject | undefined> {
    return this._onDidChangeCurrent.event;
  }

  /** Whether configuration resolution produced any Declared Project. */
  get hasDeclaredProjects(): boolean {
    return this.registry.projects.length > 0;
  }

  /** Project owning a specific resource; used by commands that carry a uri. */
  forResource(uri: Uri): DeclaredProject | undefined {
    return this.registry.findProject(uri);
  }

  /** Prompts only when a user-invoked command needs a project and cannot infer one. */
  async requireForCommand(uri?: Uri): Promise<DeclaredProject | undefined> {
    if (uri?.scheme === "file") {
      const project = this.forResource(uri);
      if (project) {
        return project;
      }
      return this.registry.projects.length >= 2
        ? this.projectQuickPick.declaredProjectPicker(this.registry.projects)
        : undefined;
    }

    const current = this.current;
    if (current) {
      return current;
    }

    if (this.registry.projects.length < 2) {
      return undefined;
    }

    return this.projectQuickPick.declaredProjectPicker(this.registry.projects);
  }

  dispose(): void {
    while (this.subscriptions.length) {
      this.subscriptions.pop()?.dispose();
    }
    this._onDidChangeCurrent.dispose();
  }

  private updateCurrent(): void {
    const newCurrent = this.current;
    if (newCurrent !== this.lastEmittedCurrent) {
      this.lastEmittedCurrent = newCurrent;
      this._onDidChangeCurrent.fire(newCurrent);
    }
  }
}
