import { TextDocument, Uri, window } from "vscode";
import type { Log } from "../core/log";
import { CurrentProject } from "./currentProject";
import type { Manifest } from "./manifestTypes";
import { Project } from "./project";
import { DeclaredProject } from "./projectRegistry";
import { Projects } from "./projects";

export class QueryManifestService {
  public constructor(
    private projects: Projects,
    private dbtTerminal: Log,
    private currentProject: CurrentProject,
  ) {}

  /** Maps the Declared Project owning `uri` to the Project the discovery path already built. */
  private resolveProject(uri?: Uri): Project | undefined {
    if (!uri) {
      return undefined;
    }
    const declared = this.currentProject.forResource(uri);
    return declared ? this.mapDeclaredProject(declared) : undefined;
  }

  public getProject(): Project | undefined {
    const current = this.currentProject.current;
    if (current) {
      return this.mapDeclaredProject(current);
    }
    return undefined;
  }

  /** The latest manifest of the project owning `uri`, or of the Current Project when `uri` is omitted. */
  public manifestFor(uri?: Uri): Manifest | undefined {
    const project = uri ? this.resolveProject(uri) : this.getProject();
    return project ? this.manifestAt(project.projectRoot) : undefined;
  }

  /** Like {@link manifestFor}, after rebuilding a parse that a source change left stale. */
  public async freshManifest(uri?: Uri): Promise<Manifest | undefined> {
    const project = uri ? this.resolveProject(uri) : this.getProject();
    await project?.ensureParsed();
    return this.manifestFor(uri);
  }

  public getProjectByUri(uri?: Uri): Project | undefined {
    return this.resolveProject(uri);
  }

  public getProjectNamesInWorkspace(): string[] | undefined {
    // remove duplicates
    return [
      ...new Set(
        this.projects.all().map((project) => project.getProjectName()),
      ),
    ];
  }

  public getProjectByName(projectName: string) {
    const projects = this.projects.all();
    return projects.find((project) => project.getProjectName() === projectName);
  }

  public getEventByCurrentProject():
    | {
        event: Manifest | undefined;
        currentDocument: TextDocument;
      }
    | undefined {
    if (window.activeTextEditor === undefined) {
      return;
    }

    const currentDocument = window.activeTextEditor.document;
    const currentFilePath = currentDocument.uri;
    return { event: this.getEventByDocument(currentFilePath), currentDocument };
  }

  public getEventByDocument(currentFilePath: Uri) {
    this.dbtTerminal.debug(
      "getting event for project, currentFilePath: ",
      currentFilePath.fsPath,
    );
    const event = this.manifestFor(currentFilePath);
    if (event === undefined) {
      this.dbtTerminal.debug("no manifest for: ", currentFilePath.fsPath);
    }
    return event;
  }

  public getSourcesInProject(currentFilePath?: Uri) {
    const event = currentFilePath && this.manifestFor(currentFilePath);
    if (!event) {
      return;
    }

    const sources = event.sourceMetaMap.entries();
    const items = Array.from(sources).map(([key, source]) => ({
      name: key,
      tables: source.tables.map((t) => t.name),
    }));

    return items;
  }

  public getModelsInProject(
    currentFilePath?: Uri,
  ): Iterable<string> | undefined {
    const event = currentFilePath && this.manifestFor(currentFilePath);
    if (!event) {
      return;
    }

    // TODO: fix for model versions
    return Array.from(event.nodeMetaMap.nodes()).map((node) => node.name);
  }

  public async getOrPickProjectFromWorkspace() {
    const uri = window.activeTextEditor?.document.uri;
    const declared = await this.currentProject.requireForCommand(uri);

    if (!declared) {
      this.dbtTerminal.debug(
        "getOrPickProjectFromWorkspace",
        "no project selected",
      );
      return;
    }

    this.dbtTerminal.debug(
      "getOrPickProjectFromWorkspace",
      `project selected: ${declared.root.fsPath}`,
    );
    return this.mapDeclaredProject(declared);
  }

  private manifestAt(root: Uri): Manifest | undefined {
    return this.projects.get(root)?.manifest;
  }

  private mapDeclaredProject(declared: DeclaredProject): Project | undefined {
    return this.projects.get(declared.root);
  }
}
